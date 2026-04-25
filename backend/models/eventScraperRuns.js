const mongoose = require("mongoose");

const sourceRunSchema = new mongoose.Schema(
  {
    source: { type: String, trim: true, required: true },
    ok: { type: Boolean, default: false },
    discoveredCount: { type: Number, default: 0 },
    savedCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    error: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const eventScraperRunSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, index: true },
    finishedAt: { type: Date, default: null },
    status: { type: String, enum: ["running", "success", "partial", "failed"], default: "running", index: true },
    minScore: { type: Number, default: 50 },
    sources: { type: [sourceRunSchema], default: [] },
    syncResult: { type: mongoose.Schema.Types.Mixed, default: null },
    roiBackfillResult: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    collection: "event_scraper_runs",
  }
);

module.exports = mongoose.model("event_scraper_runs", eventScraperRunSchema);
