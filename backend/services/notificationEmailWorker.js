const Notification = require("../models/notifications");
const CRMSettings = require("../models/crmSettings");
const User = require("../models/users");
const mongoose = require("mongoose");
const sendOTPEmail = require("./emailService");
const {
  buildNotificationEmail,
  inferTemplateKey,
  TEMPLATE_KEYS,
} = require("./emailTemplates");

let isProcessing = false;
let workerTimer = null;

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

function getReminderOffsetMinutesFromSettings(settings) {
  if (!settings) return 30;
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
    if (values.length) return values[0];
  }
  return getReminderOffsetMinutes(settings?.reminderTiming, settings?.customReminderOffsetMinutes);
}

function isReminderTemplate(templateKey) {
  return [
    TEMPLATE_KEYS.MEETING_SCHEDULED,
    TEMPLATE_KEYS.FOLLOWUP_SCHEDULED,
    TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION,
  ].includes(templateKey);
}

function getReminderTargetDate(templateKey, relatedData) {
  if (!relatedData) return null;

  if (templateKey === TEMPLATE_KEYS.MEETING_SCHEDULED) {
    return relatedData.startTime || relatedData.meetingDate || relatedData.dueDateTime || null;
  }

  if (templateKey === TEMPLATE_KEYS.FOLLOWUP_SCHEDULED) {
    return relatedData.dueDateTime || relatedData.nextActionDate || null;
  }

  if (templateKey === TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION) {
    return relatedData.startDate || relatedData.endDate || null;
  }

  return null;
}

async function markNotification(id, patch) {
  await Notification.updateOne({ _id: id }, { $set: patch });
}

async function processNotification(notificationDoc) {
  const now = new Date();
  const notification = notificationDoc.toObject ? notificationDoc.toObject() : notificationDoc;

  const user = await User.findById(notification.userId).select("name email").lean();
  if (!user?.email) {
    await markNotification(notification._id, {
      emailStatus: "skipped",
      emailLastAttemptAt: now,
      emailSkippedReason: "Recipient email missing",
      emailError: "",
    });
    return;
  }

  const templateKey = inferTemplateKey(notification);
  const emailPayload = await buildNotificationEmail({
    notification: { ...notification, templateKey },
    recipientName: user.name || "",
    appBaseUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  });

  if (isReminderTemplate(templateKey)) {
    const settings = await CRMSettings.findOne({ userId: notification.userId }).lean();
    if (!settings?.smartFollowupRemindersEnabled || !settings?.reminderMethodInApp || !settings?.reminderMethodEmail) {
      return;
    }

    const targetDateRaw = getReminderTargetDate(templateKey, emailPayload.relatedData);
    const targetDate = targetDateRaw ? new Date(targetDateRaw) : null;

    if (targetDate && !Number.isNaN(targetDate.getTime())) {
      const offsetMinutes = getReminderOffsetMinutesFromSettings(settings);
      const sendAt = new Date(targetDate.getTime() - offsetMinutes * 60 * 1000);

      if (now < sendAt) {
        return;
      }

      const expiry = new Date(targetDate.getTime() + 15 * 60 * 1000);
      if (now > expiry) {
        await markNotification(notification._id, {
          emailStatus: "skipped",
          emailLastAttemptAt: now,
          emailSkippedReason: "Reminder window expired",
          emailError: "",
          templateKey,
        });
        return;
      }
    }
  }

  try {
    await sendOTPEmail.sendEmail({
      to: user.email,
      subject: emailPayload.subject,
      html: emailPayload.html,
      text: emailPayload.text,
      fromName: "CRM Notifications",
    });

    await markNotification(notification._id, {
      emailStatus: "sent",
      emailSentAt: now,
      emailLastAttemptAt: now,
      emailError: "",
      emailSkippedReason: "",
      templateKey,
    });
  } catch (err) {
    await markNotification(notification._id, {
      emailStatus: "failed",
      emailLastAttemptAt: now,
      emailError: String(err?.message || err || "Email send failed"),
      emailSkippedReason: "",
      templateKey,
    });
  }
}

async function processPendingNotificationEmails() {
  if (isProcessing) return;
  if (mongoose.connection.readyState !== 1) return;
  isProcessing = true;
  try {
    const pending = await Notification.find({
      $or: [{ emailStatus: "pending" }, { emailStatus: { $exists: false } }],
    })
      .sort({ createdAt: 1 })
      .limit(50);

    for (const notification of pending) {
      await processNotification(notification);
    }
  } catch (err) {
    console.error("notification email worker error:", err);
  } finally {
    isProcessing = false;
  }
}

function startNotificationEmailWorker() {
  if (workerTimer) return;

  processPendingNotificationEmails().catch((err) => {
    console.error("notification worker initial run error:", err);
  });

  workerTimer = setInterval(() => {
    processPendingNotificationEmails().catch((err) => {
      console.error("notification worker loop error:", err);
    });
  }, 15000);
}

module.exports = {
  startNotificationEmailWorker,
  processPendingNotificationEmails,
};
