const mongoose = require("mongoose");

const salesForecastingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  period: {
    type: Number,
  },

  totalPipelineValue: {
    type: Number,
  },

  totalActiveDeals: {
    type: Number,
  },

  expectedWinRate: {
    type: Number,
  },

  forecastRevenue: {
    type: Number,
  },

  avgSalesCycleDays: {
    type: Number,
  },

  generatedAt: {
    type: Date,
  },

  stageBreakdown: {
    P1: {
      count: Number,
      value: Number,
    },
    P2: {
      count: Number,
      value: Number,
    },
    P3: {
      count: Number,
      value: Number,
    },
    P4: {
      count: Number,
      value: Number,
    },
    P5: {
      count: Number,
      value: Number,
    },
    P6: {
      count: Number,
      value: Number,
    },
    P7: {
      count: Number,
      value: Number,
    },
  },

  confidenceRange: {
    lowerBound: Number,
    upperBound: Number,
  },
});

module.exports = mongoose.model(
  "SalesForecasting",
  salesForecastingSchema
);
