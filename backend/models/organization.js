const mongoose = require("mongoose");

const organizationContactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: ""
    },
    designation: {
      type: String,
      trim: true,
      default: ""
    },
    phone: {
      type: String,
      trim: true,
      default: ""
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ""
    },
    is_active: {
      type: Boolean,
      default: true
    }
  },
  { _id: true }
);

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    logoUrl: {
      type: String,
      trim: true,
      default: ""
    },
    address: {
      type: String,
      trim: true,
      default: ""
    },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: ""
    },
    cinNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: ""
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: ""
    },
    contacts: {
      type: [organizationContactSchema],
      default: []
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    is_deleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    collection: "organization"
  }
);

module.exports = mongoose.model("organization", organizationSchema);
