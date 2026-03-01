const mongoose = require("mongoose");

const taxSchema = new mongoose.Schema(
  {
    rate: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    },
    is_deleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    collection: "taxes"
  }
);

module.exports = mongoose.model("taxes", taxSchema);
