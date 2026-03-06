const mongoose = require("mongoose");
const Followup = require("./models/followUp");
const LeadContacts = require("./models/leadContacts");
const { processMeetingReminders } = require("./services/whatsappMeetingWorker");
const whatsappService = require("./services/whatsappService");
const fs = require("fs");

fs.writeFileSync("test_out.txt", ""); // clear

// Mock whatsapp service so we don't spam numbers
whatsappService.sendWhatsAppMessage = async (phone, msg) => {
    fs.appendFileSync("test_out.txt", `\n[MOCK] Sending WA to ${phone}:\n${msg}\n`);
    return { status: "sent" };
};

require("dotenv").config();

async function runTest() {
    await mongoose.connect(process.env.CONN);
    console.log("Connected to DB.");

    const now = new Date();
    const in30Mins = new Date(now.getTime() + 30 * 60 * 1000);
    const in23h30m = new Date(now.getTime() + 23.5 * 60 * 60 * 1000);

    // 1. Create a dummy contact
    const testContact = await LeadContacts.create({
        lead_id: new mongoose.Types.ObjectId(), // Fake lead ID
        name: "Test User",
        phone: "919999999999",
        is_primary: true
    });

    // 2. Create 1 Hour reminder meeting
    const meeting1h = await Followup.create({
        leadId: testContact.lead_id,
        assignedTo: new mongoose.Types.ObjectId(),
        kind: "meeting",
        actionType: "zoom",
        title: "1 Hour Test Meeting",
        dueDateTime: in30Mins,
        status: "pending",
        whatsappReminder1hSent: false,
        whatsappReminder24hSent: false
    });

    // 3. Create 24 Hour reminder meeting
    const meeting24h = await Followup.create({
        leadId: testContact.lead_id,
        assignedTo: new mongoose.Types.ObjectId(),
        kind: "meeting",
        actionType: "physical",
        meetingExactLocation: "Main Office Suite 200",
        title: "24 Hour Test Meeting",
        dueDateTime: in23h30m,
        status: "pending",
        whatsappReminder1hSent: false,
        whatsappReminder24hSent: false
    });

    console.log("Created test records. Running worker pass...");

    await processMeetingReminders();

    console.log("Worker pass complete. Checking DB flags...");

    const check1h = await Followup.findById(meeting1h._id);
    const check24h = await Followup.findById(meeting24h._id);

    fs.appendFileSync("test_out.txt", `\nMeeting 1H Flags -> 1H Sent: ${check1h.whatsappReminder1hSent} 24H Sent: ${check1h.whatsappReminder24hSent}`);
    fs.appendFileSync("test_out.txt", `\nMeeting 24H Flags -> 1H Sent: ${check24h.whatsappReminder1hSent} 24H Sent: ${check24h.whatsappReminder24hSent}`);

    // Clean up
    await Followup.deleteMany({ _id: { $in: [meeting1h._id, meeting24h._id] } });
    await LeadContacts.deleteOne({ _id: testContact._id });

    console.log("Cleanup done. Exiting.");
    process.exit(0);
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
