const mongoose = require("mongoose");

const crmSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    smartFollowupRemindersEnabled: {
      type: Boolean,
    },

    aiLeadScoringEnabled: {
      type: Boolean,
    },

    predictiveAnalyticsEnabled: {
      type: Boolean,
    },

    reminderMethodInApp: {
      type: Boolean,
    },

    reminderMethodEmail: {
      type: Boolean,
    },

    reminderMethodWhatsApp: {
      type: Boolean,
    },

    reminderTiming: {
      type: String,
      enum: ["15min", "30min", "1hr", "1day"],
    },

    whatsAppBusinessConnected: {
      type: Boolean,
    },

    whatsAppBusinessAccountId: {
      type: String,
    },

    gmailConnected: {
      type: Boolean,
    },

    Email_id: {
      type: String,
    },

    googleCalendarConnected: {
      type: Boolean,
    },

    calendarAccountEmail: {
      type: String,
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  }
);

module.exports = mongoose.model("crm_settings", crmSettingsSchema);
