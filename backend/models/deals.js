const mongoose = require("mongoose");

const dealsSchema = new mongoose.Schema(
  {
    deal_name: {
      type: String,
      trim: true,
      default: "",
    },

    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "client",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },

    stage: {
      type: String,
      enum: ["P1", "P2", "P3", "P7"],
      default: "P1",
    },

    dealValue: {
      type: Number,
    },

    probability: {
      type: Number,
    },

    expectedCloseDate: {
      type: Date,
    },

    actualCloseDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
    },

    aiRiskScore: {
      type: Number,
    },

    lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leads",
    },

    isActive: {
      type: Boolean,
      default: true
    },

    is_deleted: {
      type: Boolean,
      default: false
    },

    deleted_reason: {
      type: String,
      trim: true,
      default: "",
    },

    deleted_at: {
      type: Date,
      default: null,
    },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  }
);

module.exports = mongoose.model("Deal", dealsSchema);
