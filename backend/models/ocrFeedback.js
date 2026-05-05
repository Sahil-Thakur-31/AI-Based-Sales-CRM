const mongoose = require("mongoose");

const ocrFeedbackSchema = new mongoose.Schema(
  {
    originalExtraction: {
      type: Object,
      required: true,
    },
    finalData: {
      type: Object,
      required: true,
    },
    imagePath: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("OcrFeedback", ocrFeedbackSchema);
