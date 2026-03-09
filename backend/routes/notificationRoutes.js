const express = require("express");

const router = express.Router();

const Notification = require("../models/notifications");
const Followup = require("../models/followUp");
const CRMSettings = require("../models/crmSettings");
const Meeting = require("../models/meetings");
const Event = require("../models/events");


const authenticate = require("../middlewares/auth");
const { TEMPLATE_KEYS } = require("../services/emailTemplates");

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

  if (!settings.smartFollowupRemindersEnabled || !settings.reminderMethodInApp || !settings.reminderMethodEmail) {
    return null;
  }

  if (Array.isArray(settings.reminderOptions) && settings.reminderOptions.length > 0) {
    const values = settings.reminderOptions
      .map((opt) => {
        const value = Number(opt?.value);
        const unit = String(opt?.unit || "").toLowerCase();
        if (!Number.isFinite(value) || value < 1) return null;
        if (unit === "minutes") return Math.floor(value);
        if (unit === "hours") return Math.floor(value * 60);
        if (unit === "days") return Math.floor(value * 24 * 60);
        return null;
      })
      .filter((v) => Number.isFinite(v));
    if (values.length) return Math.max(...values);
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

function formatReminderDateTime(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-IN");
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

    if (reminderOffsetMinutes !== null) {
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
    }

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
GET UPCOMING REMINDERS FOR LOGGED IN USER
*/
router.get("/reminders", authenticate, async (req, res) => {
  try {
    const now = new Date();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
    const userId = req.user._id;

    const [followups, events] = await Promise.all([
      Followup.find({
        is_deleted: false,
        assignedTo: userId,
        reminderEnabled: { $ne: false },
        status: { $in: ["pending", "overdue"] },
        dueDateTime: { $gte: now },
      })
        .select("_id leadId kind actionType clientName title dueDateTime")
        .sort({ dueDateTime: 1 })
        .limit(limit)
        .lean(),
      Event.find({
        is_deleted: false,
        status: "upcoming",
        startDate: { $gte: now },
        $or: [
          { "registrations.attendeeUsers": userId },
          { registeredBy: userId },
          { attendedBy: userId },
        ],
      })
        .select("_id name venue startDate endDate")
        .sort({ startDate: 1 })
        .limit(limit)
        .lean(),
    ]);

    const followupReminders = followups.map((item) => {
      const isMeeting = item.kind === "meeting";
      const label = isMeeting ? "Meeting Reminder" : "Follow-up Reminder";
      const itemType = getNotificationItemType(item);
      const companyName = getNotificationCompanyName(item);
      return {
        _id: `${isMeeting ? "meeting" : "followup"}-upcoming-${item._id}`,
        title: label,
        message: `${itemType} for ${companyName} is scheduled on ${formatReminderDateTime(item.dueDateTime)}.`,
        type: "info",
        relatedId: item.leadId || item._id,
        relatedType: isMeeting ? "Meeting" : "Followup",
        reminderAt: item.dueDateTime,
        createdAt: item.dueDateTime,
        sourceType: isMeeting ? "meeting" : "followup",
      };
    });

    const eventReminders = events.map((item) => {
      const venue = String(item.venue || "").trim();
      const venueText = venue ? ` at ${venue}` : "";
      return {
        _id: `event-upcoming-${item._id}`,
        title: "Event Reminder",
        message: `${item.name || "Event"} starts on ${formatReminderDateTime(item.startDate)}${venueText}.`,
        type: "info",
        relatedId: item._id,
        relatedType: "event",
        reminderAt: item.startDate,
        createdAt: item.startDate,
        sourceType: "event",
      };
    });

    const reminders = [...followupReminders, ...eventReminders]
      .sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt))
      .slice(0, limit);

    res.json(reminders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch reminders" });
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
