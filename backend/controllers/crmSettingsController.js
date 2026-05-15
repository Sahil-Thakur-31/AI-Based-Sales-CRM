const CRMSettings = require("../models/crmSettings");
const {
  normalizeNotificationSettings,
} = require("../services/notificationPreferences");

function normalizeReminderOptions(options = []) {
  if (!Array.isArray(options)) return [{ value: 10, unit: "minutes" }];
  const normalized = options
    .map((opt) => {
      const value = Number(opt?.value);
      const unit = String(opt?.unit || "").toLowerCase();
      if (!Number.isFinite(value) || value < 1) return null;
      if (!["minutes", "hours", "days"].includes(unit)) return null;
      return { value: Math.floor(value), unit };
    })
    .filter(Boolean);
  return normalized.length ? normalized : [{ value: 10, unit: "minutes" }];
}


/*
GET CURRENT USER SETTINGS
*/
exports.getMySettings = async (req, res) => {

  try {

    let settings = await CRMSettings.findOne({
      userId: req.user._id
    });

    /*
    Auto create settings if not exists
    */
    if (!settings) {

      settings = await CRMSettings.create({
        userId: req.user._id
      });

    }

    res.json(normalizeNotificationSettings(settings));

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch settings"
    });

  }

};



/*
UPDATE SETTINGS
*/
exports.updateMySettings = async (req, res) => {

  try {

    const normalizedSettings = normalizeNotificationSettings(req.body || {});

    const settings = await CRMSettings.findOneAndUpdate(

      { userId: req.user._id },

      {
        smartFollowupRemindersEnabled:
          true,

        aiLeadScoringEnabled:
          normalizedSettings.aiLeadScoringEnabled,

        predictiveAnalyticsEnabled:
          normalizedSettings.predictiveAnalyticsEnabled,

        calendarSyncEnabled:
          normalizedSettings.calendarSyncEnabled,

        reminderMethodInApp:
          normalizedSettings.reminderMethodInApp,

        reminderMethodEmail:
          normalizedSettings.reminderMethodEmail,

        reminderMethodWhatsApp:
          normalizedSettings.reminderMethodWhatsApp,

        appNotifications:
          normalizedSettings.appNotifications,

        emailNotifications:
          normalizedSettings.emailNotifications,

        reminderOptions:
          normalizeReminderOptions(normalizedSettings.reminderOptions),

        reminderTiming:
          normalizedSettings.reminderTiming,

        customReminderOffsetMinutes:
          normalizedSettings.customReminderOffsetMinutes
      },

      {
        returnDocument: "after",
        upsert: true
      }

    );

    res.json(normalizeNotificationSettings(settings));

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to update settings"
    });

  }

};
