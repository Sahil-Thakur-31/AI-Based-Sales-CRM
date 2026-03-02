const express = require("express");

const router = express.Router();

const Notification = require("../models/notifications");
const Followup = require("../models/followUp");
const CRMSettings = require("../models/crmSettings");
const Meeting = require("../models/meetings");
const Event = require("../models/events");


const authenticate = require("../middlewares/auth");
const sendOTPEmail = require("../services/emailService");
const { buildNotificationEmail, TEMPLATE_KEYS, inferTemplateKey } = require("../services/emailTemplates");

const sentReminderEmailCache = new Map();

function getReminderOffsetMinutes(reminderTiming, customReminderOffsetMinutes) {
  if (reminderTiming === "custom") {
    const value = Number(customReminderOffsetMinutes);
    if (!Number.isNaN(value) && value >= 0) return value;
    return 30;
  }

  if (reminderTiming === "15min") return 15;
  if (reminderTiming === "1hr") return 60;
  return 30;
}

function buildReminderLabel(diffMinutes) {
  if (diffMinutes <= 1) return "less than a minute left";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} left`;

  const hours = Math.ceil(diffMinutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} left`;

  const days = Math.ceil(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} left`;
}

function isReminderTemplate(templateKey) {
  return [
    TEMPLATE_KEYS.MEETING_SCHEDULED,
    TEMPLATE_KEYS.FOLLOWUP_SCHEDULED,
    TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION,
  ].includes(templateKey);
}


/*
GET ALL NOTIFICATIONS FOR LOGGED IN USER
*/
router.get("/", authenticate, async (req, res) => {

  try {

    const notifications = await Notification.find({

      userId: req.user._id

    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch notifications"
    });

  }

});


/*
MARK AS READ
*/
router.put("/:id/read", authenticate, async (req, res) => {

  try {

    await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true }
    );

    res.json({
      success: true
    });

  }
  catch {

    res.status(500).json({
      message: "Failed"
    });

  }

});


/*
CREATE NOTIFICATION (for system use)
*/
router.post("/", authenticate, async (req, res) => {

  try {

    const notification = await Notification.create({

        userId: req.user._id,

        title: req.body.title,

        message: req.body.message,

        type: req.body.type || "info",
        relatedId: req.body.relatedId || null,
        relatedType: req.body.relatedType || null

      });

    // Send immediate email for non-reminder notifications.
    try {
      const templateKey = inferTemplateKey(notification);
      if (!isReminderTemplate(templateKey) && req.user?.email) {
        const emailPayload = await buildNotificationEmail({
          notification: { ...notification.toObject(), templateKey },
          recipientName: req.user.name || "",
          appBaseUrl: process.env.FRONTEND_URL || "http://localhost:5173"
        });

        await sendOTPEmail.sendEmail({
          to: req.user.email,
          subject: emailPayload.subject,
          html: emailPayload.html,
          text: emailPayload.text,
          fromName: "CRM Notifications"
        });
      }
    } catch (mailErr) {
      console.error("Failed to send immediate notification email:", mailErr);
    }

    res.json(notification);

  }
  catch {

    res.status(500).json({
      message: "Failed"
    });

  }

});


module.exports = router;