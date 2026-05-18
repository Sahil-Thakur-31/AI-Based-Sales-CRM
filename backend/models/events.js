const mongoose = require("mongoose");

const eventRegistrationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true
    },
    eventManagerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    },
    participationRole: {
      type: String,
      trim: true,
      maxlength: 120
    },
    websiteUrl: {
      type: String,
      trim: true,
      maxlength: 2000
    },
    attendeesCount: {
      type: Number,
      min: 1,
      default: 1
    },
    specialRequirements: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    isPaymentRequired: {
      type: Boolean,
      default: true
    },
    attendeeUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users"
      }
    ],
    payment: {
      method: {
        type: String,
        trim: true,
        maxlength: 100
      },
      referenceNo: {
        type: String,
        trim: true,
        maxlength: 120
      },
      amountPaid: {
        type: Number,
        min: 0,
        default: 0
      },
      paymentDate: {
        type: Date
      },
      screenshotPath: {
        type: String,
        trim: true,
        maxlength: 500
      },
      notes: {
        type: String,
        trim: true,
        maxlength: 500
      }
    }
  },
  {
    _id: false,
    timestamps: true
  }
);

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
      ref: "industries",
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
      ref: "location",
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
      default: null
    },

    registrationCurrency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 8,
      default: ""
    },

    attendeesCount: {
      type: Number,
      min: 0,
      default: null
    },

    exhibitorsCount: {
      type: Number,
      min: 0,
      default: null
    },

    latitude: {
      type: Number,
      default: null
    },

    longitude: {
      type: Number,
      default: null
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

    featureTokens: [
      {
        type: String,
        trim: true,
        lowercase: true,
      }
    ],

    ruleEngineScore: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    tokenSimilarityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    blendedAiScore: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    engagementLabel: {
      type: String,
      enum: ["positive", "negative", "neutral"],
      default: "neutral",
      index: true
    },

    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "sources",
      index: true
    },

    expectedROIRange: {
      type: String,
      trim: true,
      maxlength: 100
      // Example: "10-20%", "High", "Low"
    },

    predictedROI: {
      type: Number,
      default: null
    },

    roiPredictionConfidence: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    recommendedParticipationRole: {
      type: String,
      trim: true,
      maxlength: 20,
      default: ""
    },

    roiDecisionSummary: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },

    roiRoleComparison: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    roiModelSource: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },

    roiHistorySampleSize: {
      type: Number,
      min: 0,
      default: 0
    },

    roiHistoryMean: {
      type: Number,
      default: null
    },

    realizedRevenue: {
      type: Number,
      min: 0,
      default: null
    },

    realizedCost: {
      type: Number,
      min: 0,
      default: null
    },

    realizedROI: {
      type: Number,
      default: null
    },

    realizedCollectedLeads: {
      type: Number,
      min: 0,
      default: null
    },

    realizedQualifiedLeads: {
      type: Number,
      min: 0,
      default: null
    },

    realizedDealsClosed: {
      type: Number,
      min: 0,
      default: null
    },

    realizedNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },

    missedReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },

    missedAt: {
      type: Date,
      default: null
    },

    missedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
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

    normalizedWebsiteUrl: {
      type: String,
      trim: true,
      index: true,
      default: ""
    },

    externalIdentityKey: {
      type: String,
      trim: true,
      index: true,
      default: ""
    },

    dedupeSignature: {
      type: String,
      trim: true,
      index: true,
      default: ""
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
        ref: "users",
        index: true
      }
    ],

    registeredBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        index: true
      }
    ],

    invitationResponses: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "users",
          index: true
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending"
        },
        respondedAt: {
          type: Date
        }
      }
    ],

    interested: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        index: true
      }
    ],

    registrations: [eventRegistrationSchema],

    is_deleted: {
      type: Boolean,
      default: false,
      index: true
    }

  },
  {
    timestamps: true
  }
);


// compound indexes for AI and dashboard queries
eventSchema.index({ industry: 1, startDate: -1 });

eventSchema.index({ aiRelevanceScore: -1, status: 1 });

eventSchema.index({ priorityTag: 1, status: 1 });

module.exports = mongoose.model("Event", eventSchema);
