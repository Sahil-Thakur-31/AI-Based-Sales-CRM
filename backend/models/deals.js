const mongoose = require("mongoose");

const dealsSchema = new mongoose.Schema(
  {
    deal_name: {
      type: String,
      trim: true,
      default: "",
    },

    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "client",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },

    stage: {
      type: String,
      enum: ["P1", "P2", "P3", "P6", "P7"],
      default: "P3",
    },

    dealValue: {
      type: Number,
    },

    probability: {
      type: Number,
    },

    expectedCloseDate: {
      type: Date,
      default: () => {
        const date = new Date();
        date.setDate(date.getDate() + 60);
        return date;
      },
    },

    actualCloseDate: {
      type: Date,
    },

    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
    },

    aiRiskScore: {
      type: Number,
    },

    lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leads",
    },

    isActive: {
      type: Boolean,
      default: true
    },

    is_deleted: {
      type: Boolean,
      default: false
    },

    deleted_reason: {
      type: String,
      trim: true,
      default: "",
    },

    reason_for_lost: {
      type: String,
      trim: true,
      default: "",
    },

    deleted_at: {
      type: Date,
      default: null,
    },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },

    forecast: {
      predictedLabel: {
        type: Number,
        enum: [0, 1],
        description: "0 = LOSS, 1 = WIN"
      },
      predictedLabelText: {
        type: String,
        enum: ["lost", "won"]
      },
      winProbability: {
        type: Number,
        min: 0,
        max: 1,
        description: "Win probability as decimal (0.0 to 1.0)"
      },
      winProbabilityPercent: {
        type: Number,
        min: 0,
        max: 100,
        description: "Win probability as percentage (0 to 100)"
      },
      forecastRevenue: {
        type: Number,
        description: "Forecast revenue = dealValue × winProbability"
      },
      generatedAt: {
        type: Date,
        description: "When the prediction was generated"
      },
      modelVersion: {
        type: String,
        default: "random_forest_v1"
      }
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  }
);

module.exports = mongoose.model("Deal", dealsSchema);
