const mongoose = require("mongoose");

const leadScraperRunSchema = new mongoose.Schema(
  {
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["running", "success", "failed"],
      default: "running",
    },
    scraperResult: {
      type: Object,
    },
    syncResult: {
      type: Object,
    },
    error: {
      type: String,
      default: "",
    },
  },
  {
    collection: "lead_scraper_runs",
  }
);

module.exports = mongoose.model("lead_scraper_runs", leadScraperRunSchema);
