const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");

const SCRAPER_SOURCES = ["predicthq", "meetup", "eventbrite", "mccia", "nasscom", "mea"];
const LOCAL_BACKEND_PYTHON = path.resolve(__dirname, "../.venv/Scripts/python.exe");
const PYTHON_CMD = process.env.PYTHON_CMD || (fs.existsSync(LOCAL_BACKEND_PYTHON) ? LOCAL_BACKEND_PYTHON : "python");
const SCRAPER_SCRIPT = path.resolve(__dirname, "./eventScraperMain.py");
const SCRAPER_EXEC_TIMEOUT_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.SCRAPER_EXEC_TIMEOUT_MS || (45 * 60 * 1000))
);
const SCRAPER_EXEC_MAX_BUFFER = Math.max(
  10 * 1024 * 1024,
  Number(process.env.SCRAPER_EXEC_MAX_BUFFER || (128 * 1024 * 1024))
);

function parseJsonFromStdout(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("Scraper returned no JSON output.");
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error(text);
  }

  const candidate = text.slice(firstBrace, lastBrace + 1);
  return JSON.parse(candidate);
}

function runScraperSource({
  source,
  minScore = 50,
}) {
  return new Promise((resolve, reject) => {
    const normalized = String(source || "").trim().toLowerCase();
    if (!SCRAPER_SOURCES.includes(normalized)) {
      reject(new Error(`Unsupported scraper source: ${source}`));
      return;
    }

    const args = [
      SCRAPER_SCRIPT,
      normalized,
      "--min-score",
      String(minScore),
      "--max-links",
      "0",
      "--max-pages",
      "0",
      "--max-depth",
      "0",
    ];

    execFile(
      PYTHON_CMD,
      args,
      {
        cwd: path.resolve(__dirname, "../.."),
        timeout: SCRAPER_EXEC_TIMEOUT_MS,
        maxBuffer: SCRAPER_EXEC_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || "").trim();
          reject(new Error(detail || `Scraper failed for ${normalized}`));
          return;
        }

        try {
          const result = parseJsonFromStdout(stdout);
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Could not parse scraper output for ${normalized}: ${parseError.message}`));
        }
      }
    );
  });
}

function backfillRoiRoleComparison({
  limit = 0,
} = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      SCRAPER_SCRIPT,
      "--backfill-roi-role-comparison",
      "--backfill-limit",
      String(Math.max(0, Number(limit) || 0)),
    ];

    execFile(
      PYTHON_CMD,
      args,
      {
        cwd: path.resolve(__dirname, "../.."),
        timeout: SCRAPER_EXEC_TIMEOUT_MS,
        maxBuffer: SCRAPER_EXEC_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || "").trim();
          reject(new Error(detail || "ROI comparison backfill failed."));
          return;
        }

        try {
          resolve(parseJsonFromStdout(stdout));
        } catch (parseError) {
          reject(new Error(`Could not parse ROI backfill output: ${parseError.message}`));
        }
      }
    );
  });
}

module.exports = {
  SCRAPER_SOURCES,
  backfillRoiRoleComparison,
  runScraperSource,
};
