const mongoose = require("mongoose");

const dealStageHistorySchema = new mongoose.Schema({
  dealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deal",
  },

  stage: {
    type: String,
  },

  movedAt: {
    type: Date,
  },

  movedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

module.exports = mongoose.model(
  "deal_stage_history",
  dealStageHistorySchema
);
