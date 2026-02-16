const mongoose = require("mongoose");

const aiLeadContactsSchema = new mongoose.Schema({


  ai_lead_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ai_generated_leads",   // FK → ai_generated_leads
    required: true
  },

  name: {
    type: String,
    required: true
  },

  designation: {
    type: String
  },

  email: {
    type: String
  },

  phone: {
    type: String
  },

  linkedin: {
    type: String
  },

  is_primary_contact: {
    type: Boolean,
    default: false
  },

  created_at: {
    type: Date,
    default: Date.now
  },

  updated_at: {
    type: Date,
    default: Date.now
  }

}, {
  collection: "ai_lead_contacts"
});

module.exports = mongoose.model("ai_lead_contacts", aiLeadContactsSchema);
