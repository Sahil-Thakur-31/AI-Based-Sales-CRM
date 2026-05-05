const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const LOCAL_PYTHON_EXEC = path.join(__dirname, "runtime", ".venv", "Scripts", "python.exe");
const BRIDGE_SCRIPT = path.join(__dirname, "bridge.py");

let pythonProcess = null;
let isReady = false;
let pendingRequests = []; // queue of { resolve, reject }
let bridgeRestartTimer = null;
let ocrUnavailableReason = "";
let activePythonExec = "";
let allowAutoRestart = true;

function collectExistingPythonPaths(baseDir) {
  try {
    if (!baseDir || !fs.existsSync(baseDir)) {
      return [];
    }

    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^python/i.test(entry.name))
      .map((entry) => path.join(baseDir, entry.name, "python.exe"))
      .filter((candidate) => fs.existsSync(candidate));
  } catch (error) {
    return [];
  }
}

function resolvePythonExec() {
  const candidates = [
    process.env.OCR_PYTHON_EXEC,
    process.env.EXPENSE_OCR_PYTHON_EXEC,
    LOCAL_PYTHON_EXEC,
    ...collectExistingPythonPaths(path.join(process.env.LOCALAPPDATA || "", "Programs", "Python")),
    ...collectExistingPythonPaths(path.join(process.env.ProgramFiles || "", "Python")),
    ...collectExistingPythonPaths(path.join(process.env["ProgramFiles(x86)"] || "", "Python")),
    "python",
    "py",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "python" || candidate === "py") {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function markOcrUnavailable(reason) {
  isReady = false;
  pythonProcess = null;
  activePythonExec = "";
  ocrUnavailableReason = reason || "OCR engine is unavailable.";
  console.warn(`[OCR] ${ocrUnavailableReason}`);
}

function disableAutoRestart(reason) {
  allowAutoRestart = false;
  if (bridgeRestartTimer) {
    clearTimeout(bridgeRestartTimer);
    bridgeRestartTimer = null;
  }
  markOcrUnavailable(reason);
}

function startPythonBridge() {
  if (pythonProcess) return;

  const pythonExec = resolvePythonExec();
  if (!pythonExec) {
    disableAutoRestart("OCR Python executable not found. Set OCR_PYTHON_EXEC or restore backend/ocr/runtime/.venv.");
    return;
  }

  ocrUnavailableReason = "";
  activePythonExec = pythonExec;

  console.log(`[OCR] Starting Python bridge with ${pythonExec}...`);
  let proc;
  try {
    proc = spawn(pythonExec, [BRIDGE_SCRIPT], {
      env: { ...process.env, OCR_USE_GPU: process.env.OCR_USE_GPU || "1" },
    });
  } catch (err) {
    disableAutoRestart(`Failed to start OCR Python bridge using ${pythonExec}: ${err.message || err}`);
    return;
  }
  pythonProcess = proc;

  proc.once("error", (err) => {
    disableAutoRestart(`Failed to start OCR Python bridge using ${pythonExec}: ${err.message || err}`);
  });

  proc.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      if (line === '{"status": "READY"}') {
        console.log("[OCR] Python bridge is READY.");
        isReady = true;
        ocrUnavailableReason = "";
        continue;
      }

      try {
        const result = JSON.parse(line);
        const req = pendingRequests.shift();
        if (req) {
          req.resolve(result);
        } else {
          console.log("[OCR] Unsolicited output:", result);
        }
      } catch (e) {
        console.error("[OCR] Invalid JSON from Python:", line);
      }
    }
  });

  proc.stderr.on("data", (data) => {
    const text = data.toString();
    console.error("[OCR Python STDERR]:", text);
    if (/ModuleNotFoundError|No module named/i.test(text)) {
      disableAutoRestart("OCR Python dependencies are missing. Install backend/ocr/runtime/requirements.txt into a Python environment and set OCR_PYTHON_EXEC, or recreate backend/ocr/runtime/.venv.");
    }
  });

  proc.on("close", (code) => {
    console.log(`[OCR] Python bridge exited with code ${code}`);
    if (pythonProcess === proc) {
      isReady = false;
      pythonProcess = null;
    }

    while (pendingRequests.length > 0) {
      pendingRequests.shift().reject(new Error("OCR Python process exited unexpectedly"));
    }

    if (!pythonProcess && allowAutoRestart) {
      if (code && code !== 0) {
        ocrUnavailableReason = ocrUnavailableReason || `OCR Python bridge exited with code ${code}.`;
      }
      bridgeRestartTimer = setTimeout(startPythonBridge, 5000);
    }
  });
}

function stopPythonBridge() {
  if (bridgeRestartTimer) {
    clearTimeout(bridgeRestartTimer);
    bridgeRestartTimer = null;
  }
  if (!pythonProcess) {
    isReady = false;
    return;
  }
  const proc = pythonProcess;
  pythonProcess = null;
  isReady = false;
  try {
    proc.kill();
  } catch (err) {
    console.error("[OCR] Failed to stop Python bridge:", err.message || err);
  }
}

function restartPythonBridge() {
  stopPythonBridge();
  allowAutoRestart = true;
  startPythonBridge();
}

function sendScanRequest(imagePath, originalName = "") {
  return new Promise((resolve, reject) => {
    if (!pythonProcess) {
      return reject(new Error(ocrUnavailableReason || "OCR bridge is not running"));
    }
    if (!isReady) {
      return reject(new Error(ocrUnavailableReason || "OCR bridge is still initializing (loading models)"));
    }

    pendingRequests.push({ resolve, reject });
    pythonProcess.stdin.write(`${imagePath}\t${originalName || ""}\n`);
  });
}

async function waitUntilReady(timeoutMs = 45000) {
  const start = Date.now();
  while (!isReady) {
    if (ocrUnavailableReason) {
      throw new Error(ocrUnavailableReason);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("OCR bridge is still initializing (loading models)");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function scanImage(imagePath, originalName = "") {
  return await sendScanRequest(imagePath, originalName);
}

async function scanImageWithRecovery(imagePath, originalName = "") {
  const firstResult = await sendScanRequest(imagePath, originalName);
  if (firstResult && String(firstResult.error || "").includes("Image file not found")) {
    console.warn("[OCR] Stale bridge suspected. Restarting Python bridge and retrying once...");
    restartPythonBridge();
    await waitUntilReady();
    return await sendScanRequest(imagePath, originalName);
  }
  return firstResult;
}

startPythonBridge();

process.on("exit", stopPythonBridge);
process.on("SIGINT", () => {
  stopPythonBridge();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopPythonBridge();
  process.exit(0);
});

module.exports = {
  scanImage: scanImageWithRecovery,
  isReady: () => isReady,
  getStatus: () => ({
    isReady,
    pythonExec: activePythonExec,
    unavailableReason: ocrUnavailableReason,
  }),
};
