const mongoose = require("mongoose");

const dealStageHistorySchema = new mongoose.Schema({
  dealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deal",
    required: true
  },

  stage: {
    type: String,
    required: true
  },

  movedAt: {
    type: Date,
    default: Date.now
  },

  movedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
  },
});

module.exports = mongoose.model(
  "deal_stage_history",
  dealStageHistorySchema
);
