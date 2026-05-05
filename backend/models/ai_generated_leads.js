const mongoose = require("mongoose");

const aiGeneratedLeadsSchema = new mongoose.Schema(
  {
    base_deal_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "deals"
    },

    generated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    },

    company_name: {
      type: String,
      required: true
    },

    website: {
      type: String
    },

    industry: {
      type: String
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
      type: String
    },

    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "sources"
    },

    status: {
      type: String,
      enum: ["new", "reviewed", "imported", "rejected"],
      default: "new"
    },

    imported_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
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
      ref: "location"
    },

    scraped_lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "scraped_leads"
    },

    source_key: {
      type: String,
      trim: true
    },

    rating: {
      type: Number
    },

    reviews_count: {
      type: Number
    },

    raw_score_meta: {
      type: Object
    },

    scraped_at: {
      type: Date
    }
  },
  {
    collection: "ai_generated_leads"
  }
);

aiGeneratedLeadsSchema.index({ scraped_lead_id: 1 }, { sparse: true });
aiGeneratedLeadsSchema.index({ website: 1 }, { sparse: true });
aiGeneratedLeadsSchema.index({ company_name: 1, Address: 1 });

module.exports = mongoose.model("ai_generated_leads", aiGeneratedLeadsSchema);
