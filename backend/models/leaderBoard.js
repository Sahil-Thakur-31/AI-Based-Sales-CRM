const mongoose = require("mongoose");

const leaderboardSchema = new mongoose.Schema(
  {
    title: {
      type: String, // e.g. "Employee of the Month"
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    remarks: {
      type: String, // optional notes
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Leaderboard", leaderboardSchema);
