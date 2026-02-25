const mongoose = require("mongoose");

const quotationItemSchema = new mongoose.Schema({

  quotationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "quotations",
    required: true
  },

  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "products",
    required: true
  },

  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },

  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  taxPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  taxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "taxes",
    default: null
  },

  subtotal: {
    type: Number,
    required: true,
    default: 0
  },

  tax: {
    type: Number,
    default: 0
  },

  netTotal: {
    type: Number,
    required: true,
    default: 0
  },

  isActive: {
    type: Boolean,
    default: true
  }

}, {
  timestamps: true   // auto adds createdAt & updatedAt
});

module.exports = mongoose.model("quotation_items", quotationItemSchema);
