const mongoose = require("mongoose");

const clientContactSchema = new mongoose.Schema({


  client_id: {
    type: String   // kept as String exactly as given
  },

  name: {
    type: String,
    required: true
  },

  designation: {
    type: String
  },

  phone: {
    type: String,
    match: [/^$|^\d{10,15}$/, "Please enter a valid phone number (10-15 digits)"]
  },

  email: {
    type: String
  },

  linkedin: {
    type: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",   // FK → users
    required: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  is_deleted: {
    type: Date   // kept as DateTime exactly as given
  },

  is_active: {
    type: Boolean,
    default: true
  }

}, {
  collection: "client_contact"
});

module.exports = mongoose.model("client_contact", clientContactSchema);
