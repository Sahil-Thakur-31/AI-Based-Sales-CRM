require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const User = require('./models/users.js');
const Followup = require('./models/followUp.js');

async function testGet() {
    await mongoose.connect(process.env.CONN);
    const user = await User.findOne({ "googleCalendar.accessToken": { $ne: null } }).lean();
    const accessToken = user.googleCalendar.accessToken;

    const evs = await Followup.find({ kind: { $in: ['meeting', 'followup'] }, is_deleted: { $ne: true }, status: { $ne: 'cancelled' } }).lean();
    const mar6 = evs.filter(e => e.dueDateTime && new Date(e.dueDateTime).toISOString().startsWith('2026-03-06'));

    for (let doc of mar6) {
        let itemId = String(doc._id);
        const crmItemKey = `meeting:${itemId}`;
        const deterministicId = `crm${crypto.createHash("md5").update(`${String(user._id)}|${crmItemKey}`).digest("hex")}`;
        try {
            const res = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${deterministicId}`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            console.log(`Event ${doc.title}: Status = ${res.data.status}, Start = ${JSON.stringify(res.data.start)}`);
        } catch (err) {
            console.log(`Event ${doc.title}: GET ERROR ${err.response?.status}`);
        }
    }
    process.exit(0);
}

testGet().catch(console.error);
