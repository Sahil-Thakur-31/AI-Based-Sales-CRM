const mongoose = require("mongoose");

const dealsSchema = new mongoose.Schema(
  {
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "client",
    },

    clientName: {
      type: String,
      trim: true,
    },

    client_contact_Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "client_contact",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },

    stage: {
      type: String,
      enum: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
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
