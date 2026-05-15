const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true
  },

  title: {
    type: String,
    required: true
  },

  message: {
    type: String,
    required: true
  },

  type: {
    type: String,
    enum: ["info", "success", "warning", "error"],
    default: "info"
  },

  isRead: {
    type: Boolean,
    default: false
  },

  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  relatedType: {
    type: String,
    default: null
  },

  templateKey: {
    type: String,
    default: null
  },

  emailStatus: {
    type: String,
    enum: ["pending", "sent", "failed", "skipped"],
    default: "pending",
    index: true
  },

  emailSentAt: {
    type: Date,
    default: null
  },

  emailLastAttemptAt: {
    type: Date,
    default: null
  },

  emailError: {
    type: String,
    default: ""
  },

  emailSkippedReason: {
    type: String,
    default: ""
  },

  deliveryChannels: {
    inApp: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: true
    }
  }

}, {

  timestamps: true

});

module.exports = mongoose.model(
  "notifications",
  notificationSchema
);
