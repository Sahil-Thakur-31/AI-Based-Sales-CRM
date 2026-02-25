const mongoose = require("mongoose");

const productsSchema = new mongoose.Schema({

  name: {
    type: String,
    required: true,
    trim: true
  },

  description: {
    type: String,
    default: ""
  },

  category: {
    type: String,
    default: ""
  },

  price: {
    type: Number,
    required: true,
    default: 0
  },

  taxPercent: {
    type: Number,
    default: 0
  },

  taxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "taxes",
    default: null
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  is_deleted: {
    type: Boolean,
    default: false
  },

}, {
  timestamps: true,
  collection: "products"
});

module.exports = mongoose.model("products", productsSchema);
