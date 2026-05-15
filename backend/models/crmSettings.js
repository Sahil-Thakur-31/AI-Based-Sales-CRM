const mongoose = require("mongoose");

const channelModuleDefaults = {
  leads: {
    type: Boolean,
    default: true,
  },
  followups: {
    type: Boolean,
    default: true,
  },
  meetings: {
    type: Boolean,
    default: true,
  },
  events: {
    type: Boolean,
    default: true,
  },
  expenses: {
    type: Boolean,
    default: true,
  },
};

const crmSettingsSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    unique: true
  },

  smartFollowupRemindersEnabled: {
    type: Boolean,
    default: true
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

  appNotifications: {
    type: new mongoose.Schema(channelModuleDefaults, { _id: false }),
    default: () => ({
      leads: true,
      followups: true,
      meetings: true,
      events: true,
      expenses: true,
    })
  },

  emailNotifications: {
    type: new mongoose.Schema(channelModuleDefaults, { _id: false }),
    default: () => ({
      leads: true,
      followups: true,
      meetings: true,
      events: true,
      expenses: true,
    })
  },

  reminderOptions: [
    {
      value: { type: Number, min: 1, default: 10 },
      unit: { type: String, enum: ["minutes", "hours", "days"], default: "minutes" }
    }
  ],

  reminderTiming: {
    type: String,
    enum: ["15min", "30min", "1hr", "custom"],
    default: "30min"
  },

  customReminderOffsetMinutes: {
    type: Number,
    min: 0,
    max: 1439,
    default: 30
  }

}, {
  timestamps: true,
  collection: "crm_settings"
});

module.exports = mongoose.model("crm_settings", crmSettingsSchema);
