const mongoose = require("mongoose");

const salesTargetsSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: function requiredUserId() {
        return (this.scope_type || "user") === "user";
      }
    },

    scope_type: {
      type: String,
      enum: ["user", "team"],
      default: "user"
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
      type: Number
    },

    team_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team"
    },

    assigned_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    },

    followup_target: {
      type: Number,
      default: 0
    },

    win_rate_target: {
      type: Number,
      default: 0
    },

    pipeline_target: {
      type: Number,
      default: 0
    },

    stretch_revenue_target: {
      type: Number,
      default: 0
    },

    notes: {
      type: String,
      trim: true,
      default: ""
    },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active"
    }
  },
  {
    collection: "sales_targets"
  }
);

module.exports = mongoose.model("sales_targets", salesTargetsSchema);
