const mongoose = require("mongoose");

const productsSchema = new mongoose.Schema({

  name: {
    type: String
  },

  description: {
    type: String
  },

  category: {
    type: String
  },

  product_code: {
    type: String
  },

  price: {
    type: Number
  },

  taxPercent: {
    type: Number
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  },

  isDeleted: {
    type: Boolean
  }

});

module.exports = mongoose.model("products", productsSchema);
