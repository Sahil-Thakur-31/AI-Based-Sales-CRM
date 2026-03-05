const mongoose = require("mongoose");
const User = require("./models/users");
const Followup = require("./models/followUp");
const { syncExistingMeetingsToGoogle } = require("./services/googleCalendarSync");
require("dotenv").config();

async function checkSync() {
    try {
        await mongoose.connect(process.env.CONN);
        console.log("DB connected");

        // Find the user with connected Google Calendar
        const user = await User.findOne({ "googleCalendar.accessToken": { $ne: null } }).lean();
        if (!user) {
            console.log("No user found with a Google Calendar access token.");
            process.exit(0);
        }

        console.log(`Found connected user: ${user.email} (${user._id})`);
        console.log(`Token ends with: ...${user.googleCalendar.accessToken.slice(-10)}`);

        // Check their pending meetings
        const now = new Date();
        const meetings = await Followup.find({
            clientName: { $in: [/^Omkar/i, /^Abhinav/i] }
        }).lean();

        console.log(`Found ${meetings.length} meetings for Omkar/Abhinav.`);
        for (const meeting of meetings) {
            console.log(`\n--- ${meeting.clientName} ---`);
            console.log(`Title: ${meeting.title}`);
            console.log(`Kind: ${meeting.kind}`);
            console.log(`Status: ${meeting.status}`);
            console.log(`Is Deleted: ${meeting.is_deleted}`);
            console.log(`Assigned To: ${meeting.assignedTo}`);
            console.log(`Due Date: ${meeting.dueDateTime}`);
            console.log(`Event Type: ${meeting.eventType}`);
        }

        process.exit(0);
    } catch (err) {
        console.error("Script error:", err);
        process.exit(1);
    }
}

checkSync();
