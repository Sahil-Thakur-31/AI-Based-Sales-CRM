const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
      index: true
    },

    industry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Industry",
      required: true,
      index: true
    },

    venue: {
      type: String,
      trim: true,
      maxlength: 300
    },

    address: {
      type: String,
      trim: true,
      maxlength: 500
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      index: true
    },

    startDate: {
      type: Date,
      required: true,
      index: true
    },

    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function(value) {
          return value >= this.startDate;
        },
        message: "End date must be after start date"
      }
    },

    registrationFee: {
      type: Number,
      min: 0,
      default: 0
    },

    attendeesCount: {
      type: Number,
      min: 0,
      default: 0
    },

    exhibitorsCount: {
      type: Number,
      min: 0,
      default: 0
    },

    aiRelevanceScore: {
      type: Number,
      min: 0,
      max: 100,
      index: true
    },

    aiRecommendation: {
      type: String,
      trim: true,
      maxlength: 1000
    },

    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Source",
      index: true
    },

    expectedROIRange: {
      type: String,
      trim: true,
      maxlength: 100
      // Example: "10-20%", "High", "Low"
    },

    priorityTag: {
      type: String,
      enum: ["high", "medium", "low", "strategic"],
      default: "medium",
      index: true
    },

    status: {
      type: String,
      enum: ["upcoming", "completed"],
      default: "upcoming",
      index: true
    },

    websiteUrl: {
      type: String,
      trim: true
    },

    description: {
      type: String,
      trim: true,
      maxlength: 3000
    },

    // relational arrays (users)
    attendedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
      }
    ],

    registeredBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
      }
    ],

    interested: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
      }
    ],

    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }

  },
  {
    timestamps: true,
    versionKey: false
  }
);


// compound indexes for AI and dashboard queries
eventSchema.index({ industry: 1, startDate: -1 });

eventSchema.index({ aiRelevanceScore: -1, status: 1 });

eventSchema.index({ priorityTag: 1, status: 1 });

module.exports = mongoose.model("Event", eventSchema);
