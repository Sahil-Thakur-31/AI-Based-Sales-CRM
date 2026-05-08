const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");

const LEAD_SCRAPER_SOURCES = ["indiamart", "google_maps"];
const LOCAL_BACKEND_PYTHON = path.resolve(__dirname, "../.venv/Scripts/python.exe");
const PYTHON_CMD = process.env.PYTHON_CMD || (fs.existsSync(LOCAL_BACKEND_PYTHON) ? LOCAL_BACKEND_PYTHON : "python");
const LEAD_SCRAPER_SCRIPT = path.resolve(__dirname, "../../leads_main.py");
const LEAD_SCRAPER_EXEC_TIMEOUT_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.LEAD_SCRAPER_EXEC_TIMEOUT_MS || 45 * 60 * 1000)
);
const LEAD_SCRAPER_EXEC_MAX_BUFFER = Math.max(
  10 * 1024 * 1024,
  Number(process.env.LEAD_SCRAPER_EXEC_MAX_BUFFER || 128 * 1024 * 1024)
);

function parseJsonFromStdout(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("Lead scraper returned no JSON output.");
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error(text);
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function runLeadScraper({
  sources = LEAD_SCRAPER_SOURCES,
  limit = Number(process.env.LEAD_SCRAPER_LIMIT || 20),
  minScore = Number(process.env.LEAD_SCRAPER_MIN_SCORE || 40),
} = {}) {
  return new Promise((resolve, reject) => {
    const normalizedSources = (Array.isArray(sources) ? sources : [])
      .map((source) => String(source || "").trim().toLowerCase())
      .filter((source) => LEAD_SCRAPER_SOURCES.includes(source));

    if (!normalizedSources.length) {
      reject(new Error("No supported lead scraper sources configured."));
      return;
    }

    const args = [
      LEAD_SCRAPER_SCRIPT,
      "--sources",
      normalizedSources.join(","),
      "--limit",
      String(Math.max(1, Number(limit) || 20)),
      "--min-score",
      String(Math.max(0, Number(minScore) || 40)),
    ];

    execFile(
      PYTHON_CMD,
      args,
      {
        cwd: path.resolve(__dirname, "../.."),
        timeout: LEAD_SCRAPER_EXEC_TIMEOUT_MS,
        maxBuffer: LEAD_SCRAPER_EXEC_MAX_BUFFER,
        env: {
          ...process.env,
          LEAD_SCRAPER_HEADLESS: process.env.LEAD_SCRAPER_HEADLESS || "1",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || "").trim();
          reject(new Error(detail || "Lead scraper failed."));
          return;
        }

        try {
          resolve(parseJsonFromStdout(stdout));
        } catch (parseError) {
          reject(new Error(`Could not parse lead scraper output: ${parseError.message}`));
        }
      }
    );
  });
}

module.exports = {
  LEAD_SCRAPER_SOURCES,
  runLeadScraper,
};
