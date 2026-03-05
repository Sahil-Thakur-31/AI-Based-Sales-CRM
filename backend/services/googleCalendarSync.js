const axios = require("axios");
const Followup = require("../models/followUp");
const User = require("../models/users");

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
                overrides: [
                    { method: 'popup', minutes: 60 },
                    { method: 'popup', minutes: 24 * 60 }, // 1 day
                ],
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
 * Called on first connection to push all pending meetings
 */
async function syncExistingMeetingsToGoogle(userId, accessToken) {
    if (!accessToken) return;

    try {
        console.log(`[GoogleCalendarSync] Starting sync for user ${userId}`);
        const now = new Date();

        const meetings = await Followup.find({
            kind: { $in: ["meeting", "followup"] },
            status: "pending",
            is_deleted: { $ne: true },
            assignedTo: userId,
            dueDateTime: { $gt: now },
            googleEventId: null // Only push ones without googleEventId upon full sync
        }).lean();

        if (!meetings.length) {
            console.log(`[GoogleCalendarSync] No un-synced upcoming meetings found for user ${userId}`);
            return;
        }

        console.log(`[GoogleCalendarSync] Found ${meetings.length} meetings to sync`);

        for (const meeting of meetings) {
            await syncSingleMeetingToGoogle(meeting, userId);
        }

        console.log(`[GoogleCalendarSync] Completed sync for user ${userId}`);
    } catch (err) {
        console.error(`[GoogleCalendarSync] Global sync error for user ${userId}:`, err);
    }
}

module.exports = { syncExistingMeetingsToGoogle, syncSingleMeetingToGoogle };
