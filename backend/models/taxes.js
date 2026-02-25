const mongoose = require("mongoose");

const taxSchema = new mongoose.Schema({

  rate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },

  is_deleted: {
    type: Boolean,
    default: false
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  }

}, {
  timestamps: true,
  collection: "taxes"
});

module.exports = mongoose.model("taxes", taxSchema);
