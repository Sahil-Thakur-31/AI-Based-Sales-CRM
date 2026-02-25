const mongoose = require("mongoose");

const crmSettingsSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    unique: true
  },

  smartFollowupRemindersEnabled: {
    type: Boolean,
    default: false
  },

  aiLeadScoringEnabled: {
    type: Boolean,
    default: false
  },

  predictiveAnalyticsEnabled: {
    type: Boolean,
    default: false
  },

  calendarSyncEnabled: {
    type: Boolean,
    default: false
  },

  reminderMethodInApp: {
    type: Boolean,
    default: true
  },

  reminderMethodEmail: {
    type: Boolean,
    default: false
  },

  reminderMethodWhatsApp: {
    type: Boolean,
    default: false
  },

  reminderTiming: {
    type: String,
    enum: ["15min", "30min", "1hr", "custom"],
    default: "30min"
  }

}, {
  timestamps: true,
  collection: "crm_settings"
});

module.exports = mongoose.model("crm_settings", crmSettingsSchema);