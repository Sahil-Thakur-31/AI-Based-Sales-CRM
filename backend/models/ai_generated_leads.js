const mongoose = require("mongoose");

const aiGeneratedLeadsSchema = new mongoose.Schema({
  

  base_deal_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "deals",   // FK → deals
    required: true
  },

  generated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",   // FK → users
    required: true
  },

  company_name: {
    type: String,
    required: true
  },

  website: {
    type: String
  },

  industry: {
    type: String,   // Enum (not values provided)
    enum: []        // kept empty since values not specified
  },

  Address: {
    type: String
  },

  employee_range: {
    type: String
  },

  turnover_range: {
    type: String
  },

  similarity_score: {
    type: Number
  },

  similarity_label: {
    type: String,
    enum: ["perfect", "excellent", "good"]
  },

  source: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "sources"   // FK → sources
  },

  status: {
    type: String,
    enum: ["new", "reviewed", "imported", "rejected"],
    default: "new"
  },

  imported_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"   // FK → users
  },

  created_at: {
    type: Date,
    default: Date.now
  },

  reviewed_at: {
    type: Date
  },

  imported_at: {
    type: Date
  },

  is_active: {
    type: Boolean,
    default: true
  },

  location: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "location"   // FK → location
  }

}, {
  collection: "ai_generated_leads"
});

module.exports = mongoose.model("ai_generated_leads", aiGeneratedLeadsSchema);
