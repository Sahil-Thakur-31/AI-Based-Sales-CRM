const { TEMPLATE_KEYS } = require("./emailTemplates");

const NOTIFICATION_MODULES = {
  leads: "leads",
  followups: "followups",
  meetings: "meetings",
  events: "events",
  expenses: "expenses",
};

const DEFAULT_APP_NOTIFICATIONS = {
  leads: true,
  followups: true,
  meetings: true,
  events: true,
  expenses: true,
};

const DEFAULT_EMAIL_NOTIFICATIONS = {
  leads: true,
  followups: true,
  meetings: true,
  events: true,
  expenses: true,
};

function getLegacyModuleDefault(settings = {}, channel, moduleKey) {
  if (channel === "app" && (moduleKey === NOTIFICATION_MODULES.followups || moduleKey === NOTIFICATION_MODULES.meetings)) {
    return settings.reminderMethodInApp !== undefined ? Boolean(settings.reminderMethodInApp) : true;
  }

  if (channel === "email" && (moduleKey === NOTIFICATION_MODULES.followups || moduleKey === NOTIFICATION_MODULES.meetings)) {
    return settings.reminderMethodEmail !== undefined ? Boolean(settings.reminderMethodEmail) : true;
  }

  return true;
}

function normalizeChannelPreferences(rawSettings = {}, channel, defaults) {
  const source =
    channel === "app"
      ? rawSettings.appNotifications || {}
      : rawSettings.emailNotifications || {};

  return Object.keys(defaults).reduce((acc, key) => {
    if (source[key] === undefined) {
      acc[key] = getLegacyModuleDefault(rawSettings, channel, key);
      return acc;
    }
    acc[key] = Boolean(source[key]);
    return acc;
  }, {});
}

function normalizeNotificationSettings(settings = {}) {
  const plain = settings?.toObject ? settings.toObject() : { ...settings };
  const appNotifications = normalizeChannelPreferences(plain, "app", DEFAULT_APP_NOTIFICATIONS);
  const emailNotifications = normalizeChannelPreferences(plain, "email", DEFAULT_EMAIL_NOTIFICATIONS);

  return {
    ...plain,
    smartFollowupRemindersEnabled: true,
    appNotifications,
    emailNotifications,
    reminderMethodInApp: Boolean(appNotifications.followups || appNotifications.meetings),
    reminderMethodEmail: Boolean(emailNotifications.followups || emailNotifications.meetings),
  };
}

function isNotificationModuleEnabled(settings = {}, channel, moduleKey) {
  const normalized = normalizeNotificationSettings(settings);
  const channelMap =
    channel === "email" ? normalized.emailNotifications : normalized.appNotifications;
  return Boolean(channelMap?.[moduleKey]);
}

function getNotificationChannels(settings = {}, moduleKey) {
  return {
    inApp: isNotificationModuleEnabled(settings, "app", moduleKey),
    email: isNotificationModuleEnabled(settings, "email", moduleKey),
  };
}

function hasNotificationChannelEnabled(settings = {}, moduleKey) {
  const channels = getNotificationChannels(settings, moduleKey);
  return Boolean(channels.inApp || channels.email);
}

function getTimedReminderModule(kind = "") {
  return String(kind).toLowerCase() === "meeting"
    ? NOTIFICATION_MODULES.meetings
    : NOTIFICATION_MODULES.followups;
}

function isTimedReminderEnabled(settings = {}, channel, kind = "") {
  const normalized = normalizeNotificationSettings(settings);
  return isNotificationModuleEnabled(normalized, channel, getTimedReminderModule(kind));
}

function resolveNotificationModule(notification = {}) {
  const templateKey = String(notification.templateKey || "").trim();
  const relatedType = String(notification.relatedType || "").trim().toLowerCase();
  const blob = `${notification.title || ""} ${notification.message || ""}`.toLowerCase();

  if (templateKey === TEMPLATE_KEYS.LEAD_ASSIGNED || relatedType.includes("lead")) {
    return NOTIFICATION_MODULES.leads;
  }

  if (
    [
      TEMPLATE_KEYS.FOLLOWUP_ASSIGNED,
      TEMPLATE_KEYS.FOLLOWUP_SCHEDULED,
    ].includes(templateKey) ||
    relatedType.includes("followup")
  ) {
    return NOTIFICATION_MODULES.followups;
  }

  if (
    [
      TEMPLATE_KEYS.MEETING_ASSIGNED,
      TEMPLATE_KEYS.MEETING_SCHEDULED,
      TEMPLATE_KEYS.MEETING_COMPLETED,
    ].includes(templateKey) ||
    relatedType.includes("meeting")
  ) {
    return NOTIFICATION_MODULES.meetings;
  }

  if (
    [
      TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION,
    ].includes(templateKey) ||
    relatedType.includes("event") ||
    blob.includes("event ")
  ) {
    return NOTIFICATION_MODULES.events;
  }

  if (
    [
      TEMPLATE_KEYS.EXPENSE_APPROVED,
      TEMPLATE_KEYS.EXPENSE_REJECTED,
    ].includes(templateKey) ||
    relatedType.includes("expense") ||
    blob.includes("expense ")
  ) {
    return NOTIFICATION_MODULES.expenses;
  }

  if (blob.includes("lead")) return NOTIFICATION_MODULES.leads;
  if (blob.includes("meeting")) return NOTIFICATION_MODULES.meetings;
  if (blob.includes("follow")) return NOTIFICATION_MODULES.followups;
  if (blob.includes("event")) return NOTIFICATION_MODULES.events;
  if (blob.includes("expense")) return NOTIFICATION_MODULES.expenses;

  return null;
}

module.exports = {
  DEFAULT_APP_NOTIFICATIONS,
  DEFAULT_EMAIL_NOTIFICATIONS,
  NOTIFICATION_MODULES,
  getNotificationChannels,
  getTimedReminderModule,
  hasNotificationChannelEnabled,
  isNotificationModuleEnabled,
  isTimedReminderEnabled,
  normalizeNotificationSettings,
  resolveNotificationModule,
};
