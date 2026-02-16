const mongoose = require("mongoose");

const userPerformanceSchema = new mongoose.Schema({


  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",   // FK → users
    required: true
  },
 
  sales_target_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "sales_targets",   // FK → sales_targets
    required: true
  },

  period_type: {
    type: String,
    enum: ["monthly", "quarterly"],
    required: true
  },

  deals_closed: {
    type: Number,
    required: true
  },

  revenue_generated: {
    type: Number   // percentage value
  },

  win_rate: {
    type: Number   // percentage value
  },

  followup_adherence_rate: {
    type: Number   // percentage value
  },

  avg_deal_value: {
    type: Number
  },

  pipeline_value: {
    type: Number
  },

  bonus_earned: {
    type: Number
  },

  created_at: {
    type: Date,
    default: Date.now
  },

  updated_at: {
    type: Date,
    default: Date.now
  }

}, {
  collection: "user_performance"
});

module.exports = mongoose.model("user_performance", userPerformanceSchema);
