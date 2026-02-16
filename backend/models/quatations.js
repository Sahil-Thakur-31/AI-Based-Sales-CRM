const mongoose = require("mongoose");

const quotationSchema = new mongoose.Schema({

  quoteNumber: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "counter",
    required: true
  },

  dealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "deals",
    required: true
  },

  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "client",
    required: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true
  },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  quoteDate: {
    type: Date,
    required: true
  },

  validUntil: {
    type: Date
  },

  subtotalAmount: {
    type: Number,
    required: true,
    default: 0
  },

  taxAmount: {
    type: Number,
    default: 0
  },

  discountAmount: {
    type: Number,
    default: 0
  },

  grandTotal: {
    type: Number,
    required: true,
    default: 0
  },

  currency: {
    type: String,
    enum: ["INR", "USD", "EUR"],
    default: "INR"
  },

  status: {
    type: String,
    enum: [
      "draft",
      "sent",
      "viewed",
      "negotiation",
      "approved",
      "rejected",
      "expired"
    ],
    default: "draft"
  },

  version: {
    type: Number,
    default: 1
  },

  notes: {
    type: String
  },

  termsAndConditions: {
    type: String
  },

  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  approvedAt: {
    type: Date
  },

  convertedToDeal: {
    type: Boolean,
    default: false
  },

  deliveryTimeline: {
    type: String
  },

  isActive: {
    type: Boolean,
    default: true
  },

  isDeleted: {
    type: Boolean,
    default: false
  }

}, { 
  timestamps: true   // automatically adds createdAt & updatedAt
});

module.exports = mongoose.model("quotations", quotationSchema);
