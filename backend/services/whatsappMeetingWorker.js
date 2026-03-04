const Followup = require("../models/followUp");
const LeadContacts = require("../models/leadContacts");
const ClientContact = require("../models/client_contact");
const { sendWhatsAppMessage } = require("./whatsappService");

let isProcessing = false;
let workerTimer = null;

async function getRecipientPhone(meeting) {
    try {
        if (meeting.leadId) {
            const contacts = await LeadContacts.find({ lead_id: meeting.leadId }).lean();
            if (contacts?.length) {
                const primary = contacts.find(c => c.is_primary) || contacts[0];
                return { phone: primary.phone, name: primary.name };
            }
        } else if (meeting.clientId) {
            const contacts = await ClientContact.find({ client_id: meeting.clientId }).lean();
            if (contacts?.length) {
                let primary = null;
                if (meeting.contactId) {
                    primary = contacts.find(c => String(c._id) === String(meeting.contactId));
                }
                if (!primary) {
                    primary = contacts.find(c => c.is_primary) || contacts[0];
                }
                return { phone: primary.phone, name: primary.name };
            }
        }
    } catch (err) {
        console.error("Error fetching recipient phone:", err);
    }
    return null;
}

function constructMessage(meeting, recipientName, timeRemaining) {
    const mode = meeting.actionType || "meeting";
    const address = meeting.meetingExactLocation || meeting.meetingLocation || meeting.address || "Online/TBD";
    const title = meeting.title || "Scheduled Meeting";
    const datetime = new Date(meeting.dueDateTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    let msg = `Hello ${recipientName || "there"},\n\n`;
    msg += `This is a reminder that you have a ${mode} Scheduled in ${timeRemaining}.\n\n`;
    msg += `*Topic:* ${title}\n`;
    msg += `*Time:* ${datetime}\n`;
    if (address && address.toLowerCase() !== "online" && !address.toLowerCase().includes("tbd")) {
        msg += `*Location:* ${address}\n`;
    }
    msg += `\nWe look forward to speaking with you!`;

    return msg;
}

async function processMeetingReminders() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const now = new Date();

        const twentyThreeHoursFromNow = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        // 24 Hours Window: Meetings between now and 24 hours from now
        const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        // 1 Hour Window: Meetings between now and 1 hour from now
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

        // 1. Process 24-hour reminders
        const meetings24h = await Followup.find({
            kind: "meeting",
            status: "pending",
            is_deleted: false,
            whatsappReminder24hSent: false,
            dueDateTime: { $gt: twentyThreeHoursFromNow, $lte: twentyFourHoursFromNow }
        }).limit(50);

        for (const meeting of meetings24h) {
            const recipient = await getRecipientPhone(meeting);
            if (recipient?.phone) {
                const msg = constructMessage(meeting, recipient.name, "24 hours");
                try {
                    await sendWhatsAppMessage(recipient.phone, msg);
                    meeting.whatsappReminder24hSent = true;
                    await meeting.save();
                } catch (err) {
                    console.error(`Failed to send 24h WA reminder for meeting ${meeting._id}:`, err?.message);
                }
            } else {
                // Mark sent anyway so we don't infinitely retry if no phone
                meeting.whatsappReminder24hSent = true;
                await meeting.save();
            }
        }

        // 2. Process 1-hour reminders
        const meetings1h = await Followup.find({
            kind: "meeting",
            status: "pending",
            is_deleted: false,
            whatsappReminder1hSent: false,
            dueDateTime: { $gt: now, $lte: oneHourFromNow }
        }).limit(50);

        for (const meeting of meetings1h) {
            const recipient = await getRecipientPhone(meeting);
            if (recipient?.phone) {
                const msg = constructMessage(meeting, recipient.name, "1 hour");
                try {
                    await sendWhatsAppMessage(recipient.phone, msg);
                    meeting.whatsappReminder1hSent = true;
                    await meeting.save();
                } catch (err) {
                    console.error(`Failed to send 1h WA reminder for meeting ${meeting._id}:`, err?.message);
                }
            } else {
                meeting.whatsappReminder1hSent = true;
                await meeting.save();
            }
        }

    } catch (err) {
        console.error("whatsappMeetingWorker loop error:", err);
    } finally {
        isProcessing = false;
    }
}

function startWhatsAppMeetingWorker() {
    if (workerTimer) return;

    processMeetingReminders().catch((err) => {
        console.error("whatsappMeetingWorker initial run error:", err);
    });

    // Run every 5 minutes
    workerTimer = setInterval(() => {
        processMeetingReminders().catch((err) => {
            console.error("whatsappMeetingWorker loop error:", err);
        });
    }, 5 * 60 * 1000);
}

module.exports = {
    startWhatsAppMeetingWorker,
    processMeetingReminders
};
