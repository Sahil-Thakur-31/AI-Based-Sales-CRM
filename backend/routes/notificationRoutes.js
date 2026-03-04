const express = require("express");

const router = express.Router();

const Notification = require("../models/notifications");
const Followup = require("../models/followUp");
const CRMSettings = require("../models/crmSettings");
const Meeting = require("../models/meetings");
const Event = require("../models/events");


const authenticate = require("../middlewares/auth");
const { TEMPLATE_KEYS } = require("../services/emailTemplates");

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

function getReminderOffsetMinutes(settings) {
  if (!settings) return 48 * 60;

  if (!settings.smartFollowupRemindersEnabled || !settings.reminderMethodInApp) {
    return null;
  }

  if (settings.reminderTiming === "15min") return 15;
  if (settings.reminderTiming === "30min") return 30;
  if (settings.reminderTiming === "1hr") return 60;
  if (settings.reminderTiming === "custom") {
    const customMinutes = Number(settings.customReminderOffsetMinutes);
    if (Number.isFinite(customMinutes) && customMinutes >= 0) {
      return customMinutes;
    }
  }

  return 30;
}

function getReminderLabel(diffMinutes) {
  if (diffMinutes <= 60) {
    const mins = Math.max(1, Math.ceil(diffMinutes));
    return `${mins} minute${mins > 1 ? "s" : ""} left`;
  }

  if (diffMinutes <= 24 * 60) {
    const hours = Math.ceil(diffMinutes / 60);
    return `${hours} hour${hours > 1 ? "s" : ""} left`;
  }

  const days = Math.ceil(diffMinutes / (24 * 60));
  return `${days} day${days > 1 ? "s" : ""} left`;
}

function getNotificationItemType(followup) {
  const actionType = String(followup?.actionType || "").trim();
  if (actionType) return actionType;
  return followup?.kind === "meeting" ? "Meeting" : "Follow-up Call";
}

function getNotificationCompanyName(followup) {
  return String(followup?.clientName || "").trim() || "the selected company";
}

function getDayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
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

    const settings = await CRMSettings.findOne({ userId: req.user._id }).lean();
    const reminderOffsetMinutes = getReminderOffsetMinutes(settings);
    const now = new Date();
    let leadReminderNotifications = [];
    let dayStartReminderNotifications = [];

    const { start: dayStart, end: dayEnd } = getDayBounds(now);
    const todaysFollowups = await Followup.find({
      is_deleted: false,
      assignedTo: req.user._id,
      reminderEnabled: { $ne: false },
      status: { $in: ["pending", "overdue"] },
      dueDateTime: { $gte: dayStart, $lt: dayEnd },
    })
      .select("title dueDateTime leadId kind clientName actionType")
      .lean();

    dayStartReminderNotifications = todaysFollowups
      .map((followup) => {
        const dueAt = new Date(followup.dueDateTime);
        if (Number.isNaN(dueAt.getTime())) return null;
        if (dueAt.getTime() <= now.getTime()) return null;

        const isMeeting = followup.kind === "meeting";
        const companyName = getNotificationCompanyName(followup);
        const itemType = getNotificationItemType(followup);

        return {
          _id: `${isMeeting ? "meeting" : "followup"}-daystart-${followup._id}-${dayStart.getTime()}`,
          userId: req.user._id,
          title: isMeeting ? "Today's Meeting Reminder" : "Today's Follow-up Reminder",
          message: `${itemType} for ${companyName} is scheduled today.`,
          type: "info",
          isRead: false,
          relatedId: followup.leadId || followup._id,
          relatedType: isMeeting ? "Meeting" : "Followup",
          createdAt: dayStart,
          updatedAt: dayStart,
        };
      })
      .filter(Boolean);

    if (reminderOffsetMinutes !== null) {
      const reminderCutoff = new Date(now.getTime() + reminderOffsetMinutes * 60 * 1000);
      const followups = await Followup.find({
        is_deleted: false,
        assignedTo: req.user._id,
        reminderEnabled: { $ne: false },
        status: { $in: ["pending", "overdue"] },
        dueDateTime: { $gte: now, $lte: reminderCutoff },
      })
        .select("title dueDateTime leadId kind clientName actionType")
        .lean();

      leadReminderNotifications = followups
        .map((followup) => {
          const dueAt = new Date(followup.dueDateTime);
          if (Number.isNaN(dueAt.getTime())) return null;

          const diffMs = dueAt.getTime() - now.getTime();
          if (diffMs <= 0) return null;

          const diffMinutes = diffMs / (60 * 1000);
          const reminderLabel = getReminderLabel(diffMinutes);
          const isMeeting = followup.kind === "meeting";
          const companyName = getNotificationCompanyName(followup);
          const itemType = getNotificationItemType(followup);

          return {
            _id: `${isMeeting ? "meeting" : "followup"}-reminder-${followup._id}-${dueAt.getTime()}`,
            userId: req.user._id,
            title: isMeeting ? "Meeting Reminder" : "Follow-up Reminder",
            message: `${itemType} for ${companyName} is scheduled soon. Scheduled time remaining: ${reminderLabel}.`,
            type: diffMinutes <= 60 ? "warning" : "info",
            isRead: false,
            relatedId: followup.leadId || followup._id,
            relatedType: isMeeting ? "Meeting" : "Followup",
            createdAt: dueAt,
            updatedAt: dueAt,
          };
        })
        .filter(Boolean);
    }

    const combined = [...dayStartReminderNotifications, ...leadReminderNotifications, ...notifications]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    res.json(combined);

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
MARK ALL AS READ
*/
router.put("/read-all", authenticate, async (req, res) => {

  try {

    await Notification.updateMany(
      {
        userId: req.user._id,
        isRead: false,
      },
      {
        $set: { isRead: true }
      }
    );

    res.json({
      success: true
    });

  }
  catch (err) {

    console.error(err);

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

    res.json(notification);

  }
  catch {

    res.status(500).json({
      message: "Failed"
    });

  }

});


module.exports = router;
