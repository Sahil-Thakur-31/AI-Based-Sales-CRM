const Followup = require("../models/followUp");
const LeadContacts = require("../models/leadContacts");
const ClientContact = require("../models/client_contact");
const mongoose = require("mongoose");
const { sendWhatsAppMessage } = require("./whatsappService");

let isProcessing = false;
let workerTimer = null;

async function getRecipientPhone(meeting) {
    try {
        if (meeting.leadId) {
            const contacts = await LeadContacts.find({ lead_id: meeting.leadId }).lean();
            if (contacts?.length) {
                const primary = contacts.find(c => c.is_primary) || contacts[0];
                let phoneStr = Array.isArray(primary.phone) ? primary.phone[0] : primary.phone;
                if (typeof phoneStr === 'string' && phoneStr.includes(',')) {
                    phoneStr = phoneStr.split(',')[0].trim();
                }
                return { phone: phoneStr, name: primary.name };
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
                let phoneStr = Array.isArray(primary.phone) ? primary.phone[0] : primary.phone;
                if (typeof phoneStr === 'string' && phoneStr.includes(',')) {
                    phoneStr = phoneStr.split(',')[0].trim();
                }
                return { phone: phoneStr, name: primary.name };
            }
        }
    } catch (err) {
        console.error("Error fetching recipient phone:", err);
    }
    return null;
}

function constructMessage(meeting, recipientName, timeRemaining) {
    const rawMode = String(meeting.actionType || "meeting").trim().toLowerCase();

    // Prioritize readable string addresses over lat/lng coordinates
    const address =
        meeting.meetingLocation ||
        meeting.address ||
        meeting.meetingExactLocation ||
        meeting.exactLocation ||
        "Online/TBD";

    const normalizedAddress = String(address || "").trim().toLowerCase();
    const isOnlineMeeting =
        rawMode.includes("online") ||
        rawMode.includes("virtual") ||
        rawMode.includes("video") ||
        normalizedAddress === "online" ||
        normalizedAddress.includes("online") ||
        normalizedAddress.includes("google meet") ||
        normalizedAddress.includes("zoom") ||
        normalizedAddress.includes("teams") ||
        normalizedAddress.includes("tbd");

    const meetingTypeLabel = isOnlineMeeting ? "Online Meeting" : "Physical Meeting";
    const title = meeting.title || "Scheduled Meeting";
    const datetime = new Date(meeting.dueDateTime).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });

    let msg = `📅 *Meeting Reminder: Your ${meetingTypeLabel} is in ${timeRemaining}*\n\n`;
    msg += `Hello *${recipientName || "there"}*,\n\n`;
    msg += `This is a friendly reminder that your *${meetingTypeLabel.toLowerCase()}* is scheduled in the next *${timeRemaining}*.\n\n`;
    msg += `📌 *Topic:* ${title}\n`;
    msg += `🕒 *Date & Time:* ${datetime}\n`;

    if (!isOnlineMeeting && normalizedAddress && !normalizedAddress.includes("tbd")) {
        msg += `📍 *Location:* ${address}\n`;
    }

    if (meeting.assignedTo && meeting.assignedTo.name) {
        msg += `🤝 *Meeting With:* *${meeting.assignedTo.name}*\n`;
    }

    msg += `\n`;
    if (!isOnlineMeeting) {
        msg += `Please ensure you arrive a few minutes early for a smooth and productive discussion.\n\n`;
    } else {
        msg += `Please be ready a few minutes early for a smooth and productive discussion.\n\n`;
    }
    msg += `We look forward to meeting with you! ✨`;

    return msg;
}

async function processMeetingReminders() {
    if (isProcessing) return;
    if (mongoose.connection.readyState !== 1) return;
    isProcessing = true;

    try {
        const now = new Date();

        // 24h window: catch meetings between 22h and 25h from now
        // Wide window prevents edge-case misses between 5-minute runs
        const twentyTwoHoursFromNow = new Date(now.getTime() + 22 * 60 * 60 * 1000);
        const twentyFiveHoursFromNow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        // 1h window: catch meetings from 20 minutes ago up to 1h from now
        // 20-min lookback handles edge cases where interval slid past the meeting time
        const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

        console.log(`[WhatsApp Worker] Running at ${now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
        console.log(`[WhatsApp Worker] 24h window: ${twentyTwoHoursFromNow.toISOString()} → ${twentyFiveHoursFromNow.toISOString()}`);
        console.log(`[WhatsApp Worker] 1h window:  ${twentyMinutesAgo.toISOString()} → ${oneHourFromNow.toISOString()}`);

        // 1. Process 24-hour reminders
        const meetings24h = await Followup.find({
            kind: "meeting",
            status: "pending",
            is_deleted: { $ne: true },
            $or: [{ whatsappReminder24hSent: false }, { whatsappReminder24hSent: { $exists: false } }],
            dueDateTime: { $gt: twentyTwoHoursFromNow, $lte: twentyFiveHoursFromNow }
        }).populate("assignedTo", "name phone").limit(50);

        console.log(`[WhatsApp Worker] Found ${meetings24h.length} meeting(s) for 24h reminder`);

        for (const meeting of meetings24h) {
            console.log(`[WhatsApp Worker] 24h → Processing meeting "${meeting.title}" (${meeting._id}) due ${meeting.dueDateTime}`);
            const recipient = await getRecipientPhone(meeting);
            if (recipient?.phone) {
                console.log(`[WhatsApp Worker] 24h → Sending to ${recipient.name} (${recipient.phone})`);
                const msg = constructMessage(meeting, recipient.name, "24 hours");
                try {
                    await sendWhatsAppMessage(recipient.phone, msg);
                    meeting.whatsappReminder24hSent = true;
                    await meeting.save();
                    console.log(`[WhatsApp Worker] 24h → Message sent and flagged for meeting ${meeting._id}`);
                } catch (err) {
                    console.error(`[WhatsApp Worker] 24h → Failed to send for meeting ${meeting._id}:`, err?.message);
                }
            } else {
                console.warn(`[WhatsApp Worker] 24h → No phone found for meeting ${meeting._id} — skipping, marking sent`);
                meeting.whatsappReminder24hSent = true;
                await meeting.save();
            }
        }

        // 2. Process 1-hour reminders
        const meetings1h = await Followup.find({
            kind: "meeting",
            status: "pending",
            is_deleted: { $ne: true },
            $or: [{ whatsappReminder1hSent: false }, { whatsappReminder1hSent: { $exists: false } }],
            dueDateTime: { $gt: twentyMinutesAgo, $lte: oneHourFromNow }
        }).populate("assignedTo", "name phone").limit(50);

        console.log(`[WhatsApp Worker] Found ${meetings1h.length} meeting(s) for 1h reminder`);

        for (const meeting of meetings1h) {
            console.log(`[WhatsApp Worker] 1h → Processing meeting "${meeting.title}" (${meeting._id}) due ${meeting.dueDateTime}`);
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
