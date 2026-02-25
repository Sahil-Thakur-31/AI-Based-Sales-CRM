const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    counterType: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true
      // examples: EXPENSE, INVOICE, REPORT, EVENT
    },

    value: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },

  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model("Counter", counterSchema);
