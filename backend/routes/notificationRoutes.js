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

<<<<<<< HEAD
    let settings = await CRMSettings.findOne({ userId: req.user._id }).lean();
    if (!settings) {
      settings = {
        smartFollowupRemindersEnabled: false,
        reminderMethodInApp: true,
        reminderMethodEmail: false,
        reminderTiming: "30min",
        customReminderOffsetMinutes: 30
      };
    }

    const reminderOffsetMinutes = getReminderOffsetMinutes(
      settings.reminderTiming,
      settings.customReminderOffsetMinutes
    );

    const now = new Date();
    const reminderWindowEnd = new Date(now.getTime() + reminderOffsetMinutes * 60 * 1000);

    const followups = settings.smartFollowupRemindersEnabled
      ? await Followup.find({
          is_deleted: false,
          assignedTo: req.user._id,
          status: { $in: ["pending", "overdue"] },
          dueDateTime: { $gte: now, $lte: reminderWindowEnd },
        })
          .select("title dueDateTime leadId clientName priority")
          .lean()
      : [];

    const leadReminderNotifications = settings.reminderMethodInApp
      ? followups
      .map((followup) => {
        const dueAt = new Date(followup.dueDateTime);
        if (Number.isNaN(dueAt.getTime())) return null;

        const diffMs = dueAt.getTime() - now.getTime();
        if (diffMs <= 0) return null;

        const diffMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
        const reminderLabel = buildReminderLabel(diffMinutes);

        return {
          _id: `lead-reminder-${followup._id}-${dueAt.getTime()}`,
          userId: req.user._id,
          title: "Lead Next Action Reminder",
          message: `${followup.title || "Upcoming follow-up"} (${reminderLabel})`,
          type: diffMinutes <= 60 ? "warning" : "info",
          isRead: false,
          relatedId: followup.leadId || followup._id,
          relatedType: "Lead",
          createdAt: dueAt,
          updatedAt: dueAt,
        };
      })
      .filter(Boolean)
      : [];

    const meetingReminders = settings.smartFollowupRemindersEnabled
      ? await Meeting.find({
          is_deleted: { $ne: true },
          assignedTo: req.user._id,
          status: { $in: ["scheduled", "rescheduled"] },
          startTime: { $gte: now, $lte: reminderWindowEnd },
        })
          .select("title clientName startTime meetingDate meetingType priority Address status")
          .lean()
      : [];

    const eventReminders = settings.smartFollowupRemindersEnabled
      ? await Event.find({
          is_deleted: { $ne: true },
          status: "upcoming",
          registeredBy: req.user._id,
          startDate: { $gte: now, $lte: reminderWindowEnd },
        })
          .select("name venue address startDate endDate registrationFee")
          .lean()
      : [];

    if (settings.smartFollowupRemindersEnabled && settings.reminderMethodEmail && req.user?.email) {
      const reminderJobs = [
        ...followups.map((followup) => ({
          cacheKey: `followup:${req.user._id}:${followup._id}:${new Date(followup.dueDateTime).getTime()}:${reminderOffsetMinutes}`,
          notification: {
            title: "Follow-up Reminder",
            message: followup.title || "Upcoming follow-up",
            type: "info",
            relatedId: followup._id,
            relatedType: "Followup",
            templateKey: TEMPLATE_KEYS.FOLLOWUP_SCHEDULED
          },
          relatedData: followup
        })),
        ...meetingReminders.map((meeting) => ({
          cacheKey: `meeting:${req.user._id}:${meeting._id}:${new Date(meeting.startTime || meeting.meetingDate).getTime()}:${reminderOffsetMinutes}`,
          notification: {
            title: "Meeting Reminder",
            message: meeting.title || "Upcoming meeting",
            type: "info",
            relatedId: meeting._id,
            relatedType: "Meeting",
            templateKey: TEMPLATE_KEYS.MEETING_SCHEDULED
          },
          relatedData: meeting
        })),
        ...eventReminders.map((eventRow) => ({
          cacheKey: `event:${req.user._id}:${eventRow._id}:${new Date(eventRow.startDate).getTime()}:${reminderOffsetMinutes}`,
          notification: {
            title: "Event Invitation Reminder",
            message: eventRow.name || "Upcoming event",
            type: "info",
            relatedId: eventRow._id,
            relatedType: "Event",
            templateKey: TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION
          },
          relatedData: eventRow
        })),
      ];

      for (const job of reminderJobs) {
        try {
          if (sentReminderEmailCache.has(job.cacheKey)) continue;

          const emailPayload = await buildNotificationEmail({
            notification: job.notification,
            recipientName: req.user.name || "",
            appBaseUrl: process.env.FRONTEND_URL || "http://localhost:5173",
            relatedData: job.relatedData
          });

          await sendOTPEmail.sendEmail({
            to: req.user.email,
            subject: emailPayload.subject,
            html: emailPayload.html,
            text: emailPayload.text,
            fromName: "CRM Reminder Bot"
          });

          sentReminderEmailCache.set(job.cacheKey, Date.now());
        }
        catch (mailErr) {
          console.error("Failed to send reminder email:", mailErr);
        }
      }
    }

    const combined = [...leadReminderNotifications, ...notifications]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    res.json(combined);
=======
    res.json(notifications);
>>>>>>> 3227199e933376f08179b5fb7dd4ef595a944bbb

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