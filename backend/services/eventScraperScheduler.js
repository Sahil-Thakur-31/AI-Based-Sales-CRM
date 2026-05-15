const cron = require("node-cron");
const { SCRAPER_SOURCES, backfillRoiRoleComparison, runScraperSource } = require("./scraperRunnerService");
const { syncScrapedEvents } = require("./scrapedEventSyncService");
const EventScraperRun = require("../models/eventScraperRuns");

const MIN_SCORE = 50;

let schedulerStarted = false;
let cronJob = null;
let runInProgress = false;

const compactSyncResult = (result = null) => {
  if (!result || typeof result !== "object") return result;
  return {
    discoveredCount: Number(result.discoveredCount || 0),
    importedCount: Number(result.importedCount || 0),
    updatedCount: Number(result.updatedCount || 0),
    skippedCount: Number(result.skippedCount || 0),
    dedupedCount: Number(result.dedupedCount || 0),
    errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
  };
};

const compactRoiBackfillResult = (result = null) => {
  if (!result || typeof result !== "object") return result;
  return {
    trained: Boolean(result.trained),
    updatedCount: Number(result.updatedCount || 0),
    skippedCount: Number(result.skippedCount || 0),
    errorCount: Number(result.errorCount || 0),
    detail: String(result.detail || ""),
  };
};

async function runScheduledScrape() {
  if (runInProgress) {
    console.log("[event-scheduler] Skip: previous scrape still running.");
    return;
  }

  runInProgress = true;
  const startedAt = new Date();
  const runStartedAt = startedAt.toISOString();
  let runRecord = null;
  try {
    runRecord = await EventScraperRun.create({
      startedAt,
      status: "running",
      minScore: MIN_SCORE,
    });
  } catch (error) {
    console.error("[event-scheduler] Failed to create scheduler run record:", error.message || error);
  }
  console.log(`[event-scheduler] Starting automatic scrape at ${runStartedAt}`);

  try {
    const runs = [];
    for (const source of SCRAPER_SOURCES) {
      try {
        const result = await runScraperSource({
          source,
          minScore: MIN_SCORE,
        });
        runs.push({ source, ok: true, result });
      } catch (error) {
        runs.push({ source, ok: false, error: error.message || String(error) });
      }
    }

    const syncResult = await syncScrapedEvents({
      sources: SCRAPER_SOURCES,
      minimumScore: MIN_SCORE,
      limit: 0,
    });
    let roiBackfillResult = null;
    try {
      roiBackfillResult = await backfillRoiRoleComparison();
    } catch (error) {
      roiBackfillResult = {
        ok: false,
        error: error.message || String(error),
      };
    }

    console.log("[event-scheduler] Automatic scrape finished.", {
      runs: runs.map((run) => ({
        source: run.source,
        ok: run.ok,
        savedCount: Number(run.result?.savedCount || 0),
        updatedCount: Number(run.result?.updatedCount || 0),
        error: run.error || "",
      })),
      sync: syncResult,
      roiBackfill: roiBackfillResult,
    });
    const runStatus = runs.every((run) => run.ok) ? "success" : runs.some((run) => run.ok) ? "partial" : "failed";
    
    if (runRecord?._id) {
      await EventScraperRun.updateOne(
        { _id: runRecord._id },
        {
          $set: {
            finishedAt: new Date(),
            status: runStatus,
            sources: runs.map((run) => ({
              source: run.source,
              ok: run.ok,
              discoveredCount: Number(run.result?.discoveredCount || 0),
              savedCount: Number(run.result?.savedCount || 0),
              updatedCount: Number(run.result?.updatedCount || 0),
              processedCount: Number(run.result?.processedCount || 0),
              skippedCount: Number(run.result?.skippedCount || 0),
              error: run.error || "",
            })),
            syncResult: compactSyncResult(syncResult),
            roiBackfillResult: compactRoiBackfillResult(roiBackfillResult),
            error: "",
          },
        }
      );
    }
  } catch (error) {
    console.error("[event-scheduler] Automatic scrape failed:", error.message || error);
    if (runRecord?._id) {
      try {
        await EventScraperRun.updateOne(
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
        console.error("[event-scheduler] Failed to write failed run record:", writeError.message || writeError);
      }
    }
  } finally {
    runInProgress = false;
  }
}

function startEventScraperScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  
  // Run scraper immediately on server start
  console.log("[event-scheduler] Scheduler initialized. Running scraper immediately...");
  void runScheduledScrape();
  
  // Schedule scraper to run at 12:00 AM every day
  cronJob = cron.schedule("0 0 * * *", async () => {
    console.log(`[event-scheduler] Scheduled daily run triggered at ${new Date().toISOString()}`);
    void runScheduledScrape();
  });

  // Make the cron job non-blocking
  if (typeof cronJob.start === "function") {
    cronJob.start();
  }
  
  console.log("[event-scheduler] Enabled automatic event scrape schedule (run on server start, then daily at 12:00 AM).");
}

function stopEventScraperScheduler() {
  if (cronJob) {
    cronJob.stop();
    console.log("[event-scheduler] Scheduler stopped.");
  }
  schedulerStarted = false;
}

module.exports = {
  startEventScraperScheduler,
  stopEventScraperScheduler,
};
