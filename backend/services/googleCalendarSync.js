const axios = require("axios");
const crypto = require("crypto");
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
            status: "confirmed",
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

function toIsoDateOnly(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function nextIsoDateOnly(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const n = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return n.toISOString().slice(0, 10);
}

function normalizeSyncItem(raw = {}) {
    const itemId = String(raw.id || "").trim();
    const type = String(raw.type || "").trim().toLowerCase();
    const title = String(raw.title || "").trim();
    const start = raw.start ? new Date(raw.start) : null;
    const end = raw.end ? new Date(raw.end) : null;
    const allDay = !!raw.allDay;

    if (!itemId || !type || !title || !start || Number.isNaN(start.getTime())) return null;

    const item = {
        itemId,
        type,
        title,
        allDay,
        start,
        end: end && !Number.isNaN(end.getTime()) ? end : null,
        notes: String(raw.notes || "").trim(),
        location: String(raw.location || "").trim(),
    };
    return item;
}

function buildGoogleEventBody(userId, item) {
    const crmItemKey = `${item.type}:${item.itemId}`;
    const descriptionParts = [
        `CRM Type: ${item.type}`,
        item.notes ? `Notes: ${item.notes}` : "",
    ].filter(Boolean);

    const body = {
        summary: item.title,
        status: "confirmed",
        description: descriptionParts.join("\n"),
        location: item.location || undefined,
        extendedProperties: {
            private: {
                crmItemKey,
                crmType: item.type,
                crmUserId: String(userId),
            },
        },
    };

    if (item.allDay) {
        const startDate = toIsoDateOnly(item.start);
        const endDateExclusive = nextIsoDateOnly(item.end || item.start);
        if (!startDate || !endDateExclusive) return null;
        body.start = { date: startDate };
        body.end = { date: endDateExclusive };
    } else {
        body.start = { dateTime: item.start.toISOString() };
        body.end = { dateTime: (item.end || new Date(item.start.getTime() + 45 * 60 * 1000)).toISOString() };
    }

    return body;
}

async function upsertGoogleCalendarItem({ accessToken, userId, item }) {
    const crmItemKey = `${item.type}:${item.itemId}`;
    const deterministicId = `crm${crypto
        .createHash("md5")
        .update(`${String(userId)}|${crmItemKey}`)
        .digest("hex")}`;
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
    };

    const body = buildGoogleEventBody(userId, item);
    if (!body) return { ok: false, reason: "invalid_event_body" };

    // 1) Try deterministic update first (stable id avoids duplicates).
    try {
        await axios.put(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${deterministicId}`,
            body,
            { headers }
        );
    } catch (err) {
        if (err?.response?.status !== 404) throw err;
        // 2) Not found -> create using deterministic id.
        const insertBody = { ...body, id: deterministicId };
        try {
            await axios.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                insertBody,
                { headers }
            );
        } catch (insertErr) {
            if (insertErr?.response?.status === 409) {
                // Rare race: event already created by another request; update it.
                await axios.put(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${deterministicId}`,
                    body,
                    { headers }
                );
            } else {
                throw insertErr;
            }
        }
    }

    // 3) Cleanup legacy duplicates (same CRM key) created before deterministic ids.
    const dupScan = await axios.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        headers,
        params: {
            maxResults: 50,
            singleEvents: false,
            showDeleted: false,
            privateExtendedProperty: [`crmItemKey=${crmItemKey}`, `crmUserId=${String(userId)}`],
        },
    });
    const dupItems = Array.isArray(dupScan.data?.items) ? dupScan.data.items : [];
    const extras = dupItems.filter((e) => String(e?.id || "") !== deterministicId);
    await Promise.all(
        extras.map((ev) =>
            axios
                .delete(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`, { headers })
                .catch(() => null)
        )
    );

    return { ok: true, mode: "upserted" };
}

async function syncSingleCrmItemToGoogle(itemRaw, userId) {
    try {
        const item = normalizeSyncItem(itemRaw);
        if (!item) return;

        const user = await User.findById(userId).select("googleCalendar").lean();
        const accessToken = user?.googleCalendar?.accessToken;
        if (!accessToken) return;

        let tokenToUse = accessToken;
        try {
            await upsertGoogleCalendarItem({ accessToken: tokenToUse, userId, item });
        } catch (err) {
            if (err?.response?.status === 401) {
                const rt = user?.googleCalendar?.refreshToken;
                const newT = await refreshGoogleAccessToken(userId, rt);
                if (newT) {
                    await upsertGoogleCalendarItem({ accessToken: newT, userId, item });
                }
            }
        }
    } catch (e) {
        console.error("[GoogleCalendarSync] syncSingleCrmItemToGoogle error", e?.response?.data || e?.message);
    }
}

module.exports = { syncExistingMeetingsToGoogle, syncSingleMeetingToGoogle, deleteSingleMeetingFromGoogle, refreshGoogleAccessToken, normalizeSyncItem, upsertGoogleCalendarItem, syncSingleCrmItemToGoogle };

