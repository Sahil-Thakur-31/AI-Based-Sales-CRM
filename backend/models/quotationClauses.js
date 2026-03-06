const mongoose = require("mongoose");

const quotationClauseSchema = new mongoose.Schema(
  {
    scopeType: {
      type: String,
      enum: ["global", "industry", "product_category"],
      required: true,
      default: "global"
    },
    industryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "industries",
      default: null
    },
    productCategory: {
      type: String,
      trim: true,
      default: ""
    },
    termsAndConditions: {
      type: String,
      trim: true,
      default: ""
    },
    priority: {
      type: Number,
      default: 100
    },
    is_deleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    collection: "quotation_clauses"
  }
);

module.exports = mongoose.model("quotation_clauses", quotationClauseSchema);
