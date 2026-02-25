const mongoose = require("mongoose");

const dealsSchema = new mongoose.Schema(
  {
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
    },

    clientName: {
      type: String,
      trim: true,
    },

    client_contact_Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContact",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
      ref: "Lead",
    },

    isActive: {
      type: Boolean,
    },

    is_deleted: {
      type: Boolean,
    },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
