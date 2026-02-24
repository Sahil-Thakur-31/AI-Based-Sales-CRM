const CRMSettings = require("../models/crmSettings");



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

        reminderTiming:
          req.body.reminderTiming
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