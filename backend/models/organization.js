const mongoose = require("mongoose");

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
    signatureUrl: {
      type: String,
      trim: true,
      default: ""
    },
    stampUrl: {
      type: String,
      trim: true,
      default: ""
    },
    address: {
      type: String,
      trim: true,
      default: ""
    },
    website: {
      type: String,
      trim: true,
      default: ""
    },
    area: {
      type: String,
      trim: true,
      default: ""
    },
    city: {
      type: String,
      trim: true,
      default: ""
    },
    pincode: {
      type: String,
      trim: true,
      default: ""
    },
    district: {
      type: String,
      trim: true,
      default: ""
    },
    state: {
      type: String,
      trim: true,
      default: ""
    },
    country: {
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
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
      match: [/^$|^\d{10,15}$/, "Please enter a valid phone number (10-15 digits)"]
    },
    alternatePhoneNumber: {
      type: String,
      trim: true,
      default: "",
      match: [/^$|^\d{10,15}$/, "Please enter a valid alternate phone number (10-15 digits)"]
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ""
    },
    paymentAccountName: {
      type: String,
      trim: true,
      default: ""
    },
    paymentAccountNumber: {
      type: String,
      trim: true,
      default: ""
    },
    paymentAccountType: {
      type: String,
      trim: true,
      default: ""
    },
    paymentBankName: {
      type: String,
      trim: true,
      default: ""
    },
    paymentIfscCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: ""
    },
    paymentUpiId: {
      type: String,
      trim: true,
      default: ""
    },
    headName: {
      type: String,
      trim: true,
      default: ""
    },
    headRole: {
      type: String,
      trim: true,
      default: ""
    },
    headPhone: {
      type: String,
      trim: true,
      default: ""
    },
    headEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ""
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
