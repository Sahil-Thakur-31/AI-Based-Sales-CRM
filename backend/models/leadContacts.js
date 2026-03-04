const mongoose = require("mongoose");

const leadContactsSchema = new mongoose.Schema(
  {
    lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leads",
    },

    name: {
      type: String,
    },

    designation: {
      type: String,
    },

    phone: {
      type: String,
      match: [/^$|^\d{10,15}$/, "Please enter a valid phone number (10-15 digits)"],
    },

    email: {
      type: String,
    },

    linkedin: {
      type: String,
    },

    address: {
      type: String,
    },

    is_primary: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

// module.exports = mongoose.model("LeadContacts", leadContactsSchema);
module.exports =
  mongoose.models.LeadContacts ||
  mongoose.model("LeadContacts", leadContactsSchema);