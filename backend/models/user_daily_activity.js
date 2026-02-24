const mongoose = require("mongoose");

const userDailyActivitySchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true
  },

  activityType: {
    type: String,
    enum: [
      "lead",
      "deal",
      "followup",
      "quotation",
      "client",
      "event",
      "expense"
    ],
    required: true
  },

  activityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  activityStatus: {
    type: String
  },

  title: {
    type: String
  },

  description: {
    type: String
  },

  aiProductivityScore: {
    type: Number
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  },

  is_deleted: {
    type: Boolean
  }

});

module.exports = mongoose.model("user_daily_activity", userDailyActivitySchema);
