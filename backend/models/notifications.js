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
  }

}, {

  timestamps: true

});

module.exports = mongoose.model(
  "notifications",
  notificationSchema
);