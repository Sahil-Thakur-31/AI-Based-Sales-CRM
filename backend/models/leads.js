const mongoose = require("mongoose");

const leadsSchema = new mongoose.Schema(
  {
    is_existing_company: {
      type: String,
      enum: ["Yes", "No"],
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
      type: String,
      enum: ["Yes", "No"],
    },

    next_action: {
      type: String,
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    is_deleted: {
      type: String,
      enum: ["Yes", "No"],
      default: "No",
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

module.exports = mongoose.model("Leads", leadsSchema);
