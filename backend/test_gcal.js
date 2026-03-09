require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('./models/users.js');
const Followup = require('./models/followUp.js');
const crypto = require('crypto');

// Copied from googleAuthRoutes.js
function buildGoogleEventBody(userId, item) {
    const crmItemKey = `${item.type}:${item.itemId}`;
    const descriptionParts = [
        `CRM Type: ${item.type}`,
        item.notes ? `Notes: ${item.notes}` : "",
    ].filter(Boolean);

    const body = {
        summary: item.title,
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
        body.start = { date: item.start.toISOString().slice(0, 10) };
        body.end = { date: (new Date(item.end || item.start.getTime() + 24 * 3600 * 1000)).toISOString().slice(0, 10) };
    } else {
        body.start = { dateTime: item.start.toISOString() };
        body.end = { dateTime: (item.end || new Date(item.start.getTime() + 45 * 60 * 1000)).toISOString() };
    }
    return body;
}

async function testSync() {
    await mongoose.connect(process.env.CONN);
    const user = await User.findOne({ "googleCalendar.accessToken": { $ne: null } }).lean();
    if (!user) {
        console.log("No connected user");
        process.exit(0);
    }
    const accessToken = user.googleCalendar.accessToken;
    console.log("User found:", user._id);

    const evs = await Followup.find({ kind: { $in: ['meeting', 'followup'] }, is_deleted: { $ne: true }, status: { $ne: 'cancelled' } }).lean();
    const mar6 = evs.filter(e => e.dueDateTime && new Date(e.dueDateTime).toISOString().startsWith('2026-03-06'));
    if (mar6.length === 0) { console.log('No mar6 events'); process.exit(0); }

    const doc = mar6[0];
    const start = new Date(doc.dueDateTime);
    const end = new Date(start.getTime() + 45 * 60 * 1000);

    const item = {
        itemId: String(doc._id),
        type: "meeting",
        title: doc.title,
        start: start,
        end: end,
        allDay: false,
        notes: doc.notes,
        location: doc.address || ""
    };

    const crmItemKey = `${item.type}:${item.itemId}`;
    const deterministicId = `crm${crypto.createHash("md5").update(`${String(user._id)}|${crmItemKey}`).digest("hex")}`;
    const body = buildGoogleEventBody(user._id, item);
    console.log("SENDING BODY:", JSON.stringify(body, null, 2));

    try {
        const res = await axios.post("https://www.googleapis.com/calendar/v3/calendars/primary/events", { ...body, id: deterministicId }, {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
        });
        console.log("SUCCESS!", res.status);
    } catch (err) {
        if (err.response?.status === 409) console.log("409 Conflict - already exists");
        else console.log("ERROR POST:", err.response?.data || err.message);

        try {
            const res2 = await axios.put(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${deterministicId}`, body, {
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
            });
            console.log("SUCCESS PUT!", res2.status);
        } catch (err2) {
            console.log("ERROR PUT:", err2.response?.data || err2.message);
        }
    }
    process.exit(0);
}

testSync().catch(console.error);
