const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },

    reportType: {
      type: String,
      required: true,
      enum: [
        "sales",
        "expense",
        "pipeline",
        "team",
        "activity",
        "custom"
      ],
      index: true
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    timePeriodStart: {
      type: Date,
      required: true,
      index: true
    },

    timePeriodEnd: {
      type: Date,
      required: true,
      index: true,
      validate: {
        validator: function(value) {
          return value >= this.timePeriodStart;
        },
        message: "timePeriodEnd must be after timePeriodStart"
      }
    },

    format: {
      type: String,
      required: true,
      enum: ["pdf", "excel"]
    },

    fileUrl: {
      type: String,
      default: null,
      trim: true
    },

    status: {
      type: String,
      enum: ["generating", "completed", "failed"],
      default: "generating",
      index: true
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }

  },
  {
    timestamps: { createdAt: true, updatedAt: false }, 
    versionKey: false
  }
);


reportSchema.index({
  generatedBy: 1,
  reportType: 1,
  createdAt: -1
});


module.exports = mongoose.model("Report", reportSchema);
