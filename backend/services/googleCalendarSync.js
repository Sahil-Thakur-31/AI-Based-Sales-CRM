const axios = require("axios");
const Followup = require("../models/followUp");
const User = require("../models/users");

function isMeetingLikeRecord(meeting) {
    if (!meeting) return false;
    if (String(meeting.kind || "").toLowerCase() === "meeting") return true;
    const action = String(meeting.actionType || "").toLowerCase();
    return action.includes("meeting");
}

function toMinutesBefore(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 1) return null;
    const u = String(unit || "").toLowerCase();
    if (u === "minutes") return Math.floor(v);
    if (u === "hours") return Math.floor(v * 60);
    if (u === "days") return Math.floor(v * 24 * 60);
    return null;
}

function buildReminderOverrides(meeting) {
    if (meeting?.reminderEnabled === false) return [];

    const options = Array.isArray(meeting?.reminderOptions) ? meeting.reminderOptions : [];
    const mapped = options
        .map((opt) => toMinutesBefore(opt?.value, opt?.unit))
        .filter((m) => Number.isFinite(m) && m >= 1)
        .map((minutes) => ({ method: "popup", minutes }));

    if (mapped.length > 0) return mapped;

    // Fallback defaults if no custom options are present.
    return [
        { method: "popup", minutes: 60 },
        { method: "popup", minutes: 24 * 60 },
    ];
}

/**
 * Refreshes the Google Access Token using the stored refresh token
 */
async function refreshGoogleAccessToken(userId, refreshToken) {
    if (!refreshToken) return null;

    try {
        const response = await axios.post("https://oauth2.googleapis.com/token", {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        });

        const newAccessToken = response.data.access_token;

        await User.updateOne(
            { _id: userId },
            { $set: { "googleCalendar.accessToken": newAccessToken } }
        );

        console.log(`[GoogleCalendarSync] Refreshed access token for user ${userId}`);
        return newAccessToken;
    } catch (err) {
        console.error(`[GoogleCalendarSync] Failed to refresh token for user ${userId}:`, err?.response?.data || err?.message);
        return null; // Refresh failed, might need re-auth
    }
}

/**
 * Syncs a single meeting to Google Calendar
 */
async function syncSingleMeetingToGoogle(meeting, userId) {
    try {
        // Sync only meeting-like records (not regular followups).
        if (!isMeetingLikeRecord(meeting)) return null;

        const user = await User.findById(userId).select("googleCalendar").lean();
        const accessToken = user?.googleCalendar?.accessToken;

        if (!accessToken) return null; // Not connected

        // Construct title
        let title = `Meeting: ${meeting.title || "Subject Not Provided"}`;
        if (meeting.clientName || meeting.companyName) {
            title += ` with ${meeting.clientName || meeting.companyName}`;
        }

        // Construct location
        let location = meeting.meetingLocation || meeting.address || meeting.meetingExactLocation || meeting.exactLocation || "";

        // Calculate start and end times
        const startTime = new Date(meeting.dueDateTime);
        const duration = meeting.durationMinutes || 45;
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

        let description = meeting.agenda || meeting.notes || "No agenda provided.";
        description += `\n\nPriority: ${meeting.priority || "Normal"}`;
        if (meeting.eventType) {
            description += `\nType: ${meeting.eventType}`;
        }

        const eventBody = {
            summary: title,
            location: location,
            description: description,
            start: {
                dateTime: startTime.toISOString(),
            },
            end: {
                dateTime: endTime.toISOString(),
            },
            reminders: {
                useDefault: false,
                overrides: buildReminderOverrides(meeting),
            }
        };

        const makeRequest = async (token) => {
            const headers = {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            };

            if (meeting.googleEventId) {
                // Update existing event
                return await axios.put(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${meeting.googleEventId}`,
                    eventBody,
                    { headers }
                ).catch(err => {
                    if (err?.response?.status === 404) {
                        return axios.post("https://www.googleapis.com/calendar/v3/calendars/primary/events", eventBody, { headers });
                    }
                    throw err;
                });
            } else {
                // Create new event
                return await axios.post(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    eventBody,
                    { headers }
                );
            }
        };

        let res;
        try {
            res = await makeRequest(accessToken);
        } catch (err) {
            if (err?.response?.status === 401) {
                // Token expired, refresh it
                const refreshToken = user?.googleCalendar?.refreshToken;
                if (!refreshToken) throw new Error("No refresh token available");

                console.log(`[GoogleCalendarSync] Access token expired for user ${userId}, attempting refresh...`);
                const newAccessToken = await refreshGoogleAccessToken(userId, refreshToken);
                if (!newAccessToken) throw new Error("Could not refresh token");

                // Retry once
                res = await makeRequest(newAccessToken);
            } else {
                throw err;
            }
        }

        // Save Google Event ID to DB if it's new
        if (res.data.id && res.data.id !== meeting.googleEventId) {
            await Followup.updateOne({ _id: meeting._id }, { $set: { googleEventId: res.data.id } });
        }

        console.log(`[GoogleCalendarSync] Synced meeting ${meeting._id} to GCal successfully`);
        return res.data.id;

    } catch (err) {
        console.error(`[GoogleCalendarSync] Failed to sync meeting ${meeting._id}:`, err?.response?.data || err?.message);
        return null;
    }
}

/**
 * Legacy bulk sync is intentionally disabled.
 * We sync only when a meeting is created/edited.
 */
async function syncExistingMeetingsToGoogle(userId, accessToken) {
    console.log(`[GoogleCalendarSync] Bulk sync skipped for user ${userId}. Meeting sync is create/edit only.`);
    return null;
}

/**
 * Deletes a single Google Calendar event for a meeting.
 */
async function deleteSingleMeetingFromGoogle(meeting, userId) {
    try {
        if (!isMeetingLikeRecord(meeting)) return null;
        if (!meeting?.googleEventId) return null;

        const user = await User.findById(userId).select("googleCalendar").lean();
        const accessToken = user?.googleCalendar?.accessToken;
        if (!accessToken) return null;

        const makeRequest = async (token) => {
            const headers = {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            };

            return await axios.delete(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${meeting.googleEventId}`,
                { headers }
            );
        };

        try {
            await makeRequest(accessToken);
        } catch (err) {
            if (err?.response?.status === 404) {
                // Already deleted in Google Calendar.
            } else if (err?.response?.status === 401) {
                const refreshToken = user?.googleCalendar?.refreshToken;
                if (!refreshToken) throw new Error("No refresh token available");
                const newAccessToken = await refreshGoogleAccessToken(userId, refreshToken);
                if (!newAccessToken) throw new Error("Could not refresh token");
                await makeRequest(newAccessToken);
            } else {
                throw err;
            }
        }

        await Followup.updateOne({ _id: meeting._id }, { $set: { googleEventId: null } });
        console.log(`[GoogleCalendarSync] Deleted GCal event for meeting ${meeting._id}`);
        return true;
    } catch (err) {
        console.error(`[GoogleCalendarSync] Failed to delete GCal event for meeting ${meeting?._id}:`, err?.response?.data || err?.message);
        return null;
    }
}

module.exports = { syncExistingMeetingsToGoogle, syncSingleMeetingToGoogle, deleteSingleMeetingFromGoogle };
