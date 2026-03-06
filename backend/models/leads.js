const mongoose = require("mongoose");

const leadsSchema = new mongoose.Schema(
  {
    is_existing_company: {
      type: Boolean,
      default: false,
    },

    is_existing_client: {
      type: Boolean,
      default: false,
    },

    company_name: {
      type: String,
    },

    industry: {
      type: String,
    },

    employee_count: {
      type: Number,
    },

    turnover_range: {
      type: String,
    },

    Address: {
      type: String,
    },

    website: {
      type: String,
    },

    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Source",
    },

    referred_by_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    expo_event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "events",
    },

    lead_temperature: {
      type: String,
      enum: ["cold", "warm", "hot"],
    },

    deal_value_estimate: {
      type: Number,
    },

    assigned_to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "rejected"],
    },

    converted_deal_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
    },

    last_contact_date: {
      type: Date,
    },

    converted_to_deal: {
      type: Boolean,
      default: false,
    },

    next_action: {
      type: String,
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    is_deleted: {
      type: Boolean,
      default: false,
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

module.exports =
  mongoose.models.Leads ||
  mongoose.model("Leads", leadsSchema);
