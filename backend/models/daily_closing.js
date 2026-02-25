// models/DailyClosing.js
const mongoose = require("mongoose");

const dailyClosingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    description: {
      type: String,
      trim: true,
      required: true,
    },

    status: {
      type: String,
      enum: ["submitted", "notsubmitted"],
      default: "notsubmitted",
    },

    user_daily_activity_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_daily_activity",
      required: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // creates createdAt & updatedAt automatically
  }
);

module.exports = mongoose.model("daily_closing", dailyClosingSchema);
