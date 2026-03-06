const CRMSettings = require("../models/crmSettings");

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

    res.json(settings);

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

    const settings = await CRMSettings.findOneAndUpdate(

      { userId: req.user._id },

      {
        smartFollowupRemindersEnabled:
          req.body.smartFollowupRemindersEnabled,

        aiLeadScoringEnabled:
          req.body.aiLeadScoringEnabled,

        predictiveAnalyticsEnabled:
          req.body.predictiveAnalyticsEnabled,

        calendarSyncEnabled:
          req.body.calendarSyncEnabled,

        reminderMethodInApp:
          req.body.reminderMethodInApp,

        reminderMethodEmail:
          req.body.reminderMethodEmail,

        reminderMethodWhatsApp:
          req.body.reminderMethodWhatsApp,

        reminderOptions:
          normalizeReminderOptions(req.body.reminderOptions),

        reminderTiming:
          req.body.reminderTiming,

        customReminderOffsetMinutes:
          req.body.customReminderOffsetMinutes
      },

      {
        returnDocument: "after",
        upsert: true
      }

    );

    res.json(settings);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to update settings"
    });

  }

};
