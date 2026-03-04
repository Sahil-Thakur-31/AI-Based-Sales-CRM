const mongoose = require("mongoose");

const quotationPaymentTermsSchema = new mongoose.Schema(
  {
    paymentTerms: {
      type: String,
      trim: true,
      default: ""
    },
    is_deleted: {
      type: Boolean,
      default: false
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    }
  },
  {
    timestamps: true,
    collection: "quotation_payment_terms"
  }
);

module.exports = mongoose.model("quotation_payment_terms", quotationPaymentTermsSchema);
