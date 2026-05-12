const cron = require("node-cron");
const { runLeadScraper } = require("./leadScraperRunnerService");
const { syncScrapedLeads } = require("./scrapedLeadSyncService");
const LeadScraperRun = require("../models/leadScraperRuns");

let schedulerStarted = false;
let cronJob = null;
let runInProgress = false;

function compactScraperResult(result = {}) {
  const runs = Array.isArray(result.runs) ? result.runs : [];
  return {
    runs: runs.map((run) => ({
      source: run.source || "",
      ok: Boolean(run.ok),
      discoveredCount: Number(run.result?.discoveredCount || 0),
      savedCount: Number(run.result?.savedCount || 0),
      updatedCount: Number(run.result?.updatedCount || 0),
      processedCount: Number(run.result?.processedCount || 0),
      skippedCount: Number(run.result?.skippedCount || 0),
      error: run.error || "",
    })),
  };
}

async function runScheduledLeadScrape() {
  if (runInProgress) {
    console.log("[lead-scheduler] Skip: previous lead scrape still running.");
    return;
  }

  runInProgress = true;
  const startedAt = new Date();
  let runRecord = null;

  try {
    runRecord = await LeadScraperRun.create({
      startedAt,
      status: "running",
    });
  } catch (error) {
    console.error("[lead-scheduler] Failed to create run record:", error.message || error);
  }

  console.log(`[lead-scheduler] Starting automatic lead scrape at ${startedAt.toISOString()}`);

  try {
    const scraperResult = await runLeadScraper();
    const syncResult = await syncScrapedLeads();

    if (runRecord?._id) {
      await LeadScraperRun.updateOne(
        { _id: runRecord._id },
        {
          $set: {
            finishedAt: new Date(),
            status: "success",
            scraperResult: compactScraperResult(scraperResult),
            syncResult,
            error: "",
          },
        }
      );
    }

    console.log("[lead-scheduler] Automatic lead scrape finished.", {
      scraper: compactScraperResult(scraperResult),
      sync: syncResult,
    });
  } catch (error) {
    console.error("[lead-scheduler] Automatic lead scrape failed:", error.message || error);
    if (runRecord?._id) {
      try {
        await LeadScraperRun.updateOne(
          { _id: runRecord._id },
          {
            $set: {
              finishedAt: new Date(),
              status: "failed",
              error: error.message || String(error),
            },
          }
        );
      } catch (writeError) {
        console.error("[lead-scheduler] Failed to write failed run record:", writeError.message || writeError);
      }
    }
  } finally {
    runInProgress = false;
  }
}

function startLeadScraperScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log("[lead-scheduler] Scheduler initialized. Running lead scraper immediately...");
  void runScheduledLeadScrape();

  cronJob = cron.schedule("0 */2 * * *", () => {
    console.log(`[lead-scheduler] Scheduled run triggered at ${new Date().toISOString()}`);
    void runScheduledLeadScrape();
  });

  if (typeof cronJob.start === "function") {
    cronJob.start();
  }

  console.log("[lead-scheduler] Enabled automatic lead scrape schedule (run on server start, then every 2 hours).");
}

function stopLeadScraperScheduler() {
  if (cronJob) {
    cronJob.stop();
    console.log("[lead-scheduler] Scheduler stopped.");
  }
  schedulerStarted = false;
}

module.exports = {
  runScheduledLeadScrape,
  startLeadScraperScheduler,
  stopLeadScraperScheduler,
};
