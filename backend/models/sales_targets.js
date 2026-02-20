const mongoose = require("mongoose");

const salesTargetsSchema = new mongoose.Schema({


  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",   // FK → users
    required: true
  },

  period_type: {
    type: String,
    enum: ["monthly", "quarterly"],
    required: true
  },

  period_start: {
    type: Date,
    required: true
  },

  period_end: {
    type: Date,
    required: true
  },

  revenue_target: {
    type: Number,
    required: true
  },

  deal_target: {
    type: Number,
    required: true
  },

  w: {
    type: Object  
  },

  created_at: {
    type: Date,
    default: Date.now
  },

  updated_at: {
    type: Date,
    default: Date.now
  },

  Bonus_percent: {
    type: Number   // percentage value
  }

}, {
  collection: "sales_targets"
});

module.exports = mongoose.model("sales_targets", salesTargetsSchema);
