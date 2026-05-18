const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Tesseract = require("tesseract.js");

const createWorker = Tesseract.createWorker;

const OCR_TMP_ROOT = path.join(__dirname, "..", "uploads", "receipt", "_ocr_tmp");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const resolveTesseractLangPath = () => {
  const candidates = [
    path.join(__dirname, ".."),
    PROJECT_ROOT,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "eng.traineddata"))) {
      return candidate;
    }
  }

  return path.join(__dirname, "..");
};
const TESSERACT_LANG_PATH = resolveTesseractLangPath();
const hasLocalTesseractLanguage = fs.existsSync(path.join(TESSERACT_LANG_PATH, "eng.traineddata"));
const EXPENSE_ML_ROOT = path.join(__dirname, "..", "expense_ocr_ml");
const EXPENSE_ML_SCRIPT_PATH = path.join(EXPENSE_ML_ROOT, "infer_fields.py");
const EXPENSE_ML_MODEL_PATH = path.join(
  EXPENSE_ML_ROOT,
  "artifacts",
  "field_model.pkl"
);
const EXPENSE_CATEGORY_MODEL_PATH = path.join(
  EXPENSE_ML_ROOT,
  "artifacts",
  "category_model.pkl"
);
const WINDOWS_TESSERACT_DIR = "C:\\Program Files\\Tesseract-OCR";
const WINDOWS_TESSERACT_CMD = path.join(WINDOWS_TESSERACT_DIR, "tesseract.exe");
const LOCAL_OCR_PYTHON_CMD = path.join(__dirname, "..", ".venv-ocr", "Scripts", "python.exe");
const OCR_TIMEOUT_MS = Number(process.env.EXPENSE_OCR_TIMEOUT_MS || 12000);
const OCR_ML_TIMEOUT_MS = Number(process.env.EXPENSE_OCR_ML_TIMEOUT_MS || 28000);
const OCR_TESSERACT_TIMEOUT_MS = Number(process.env.EXPENSE_OCR_TESSERACT_TIMEOUT_MS || 9000);
const OCR_MAX_REASONABLE_TOTAL = Number(process.env.EXPENSE_OCR_MAX_REASONABLE_TOTAL || 200000);
const DISABLE_PYTHON_OCR = String(process.env.EXPENSE_OCR_DISABLE_PYTHON || "").toLowerCase() === "true";
const DISABLE_ML_OCR = String(process.env.EXPENSE_OCR_DISABLE_ML || "").toLowerCase() === "true";
const APP_EXPENSE_CATEGORY_MAP = {
  travel: "travel",
  hotel: "other",
  food: "food",
  stationery: "stationery",
  stationary: "stationery",
  medical: "other",
  other: "other",
};
const AUTO_ASSIGNABLE_EXPENSE_CATEGORIES = new Set(["travel", "food", "stationery"]);

const CATEGORY_KEYWORDS = {
  food: [
    "restaurant", "food", "meal", "breakfast", "lunch", "dinner", "snack", "cafe",
    "coffee", "tea", "pizza", "burger", "sweets", "juice", "kitchen", "dining",
    "dhaba", "biryani", "thali", "pancha", "panchalee",
    "swiggy", "zomato", "mcdonalds", "kfc", "dominos", "subway", "starbucks"
  ],
  hotel: [
    "hotel stay", "room booking", "room rent", "accommodation", "check in",
    "check-in", "lodging", "resort", "guest house", "guesthouse", "oyo", "airbnb",
    "makemytrip", "agoda", "booking.com"
  ],
  travel: [
    "travel", "trip", "taxi", "cab", "uber", "ola", "bus", "train", "flight",
    "airline", "fuel", "petrol", "diesel", "parking", "toll", "metro",
    "irctc", "redbus", "indigo", "air india", "spicejet", "fastag"
  ],
  stationery: [
    "stationery", "stationary", "office supply", "office supplies", "notebook",
    "pen", "pencil", "paper", "printout", "print", "xerox", "copy", "cartridge",
    "marker", "file folder", "blinkit", "zepto", "instamart"
  ],
  medical: [
    "medical", "doctor", "clinic", "hospital", "pharmacy", "medicine", "medicines",
    "diagnostic", "lab", "consultation", "health", "scan", "test",
    "apollo", "pharmeasy", "1mg", "netmeds", "practo"
  ],
};

const OTHER_CATEGORY_KEYWORDS = {
  medical: CATEGORY_KEYWORDS.medical,
};

const PAYMENT_SCREENSHOT_TERMS = [
  "upi",
  "transaction",
  "txn",
  "utr",
  "bank",
  "debited",
  "credited",
  "paid to",
  "received from",
  "payment",
  "google pay",
  "gpay",
  "phonepe",
  "paytm",
  "beneficiary",
  "transfer",
  "transferred",
  "ref no",
  "completed",
  "pay again",
  "upi transaction id",
  "google transaction id",
  "transaction id",
];

const PAYMENT_VENDOR_LABELS = [
  "paid to",
  "received from",
  "merchant",
  "beneficiary",
  "payee",
  "to",
];

const CURRENCY_DEFINITIONS = [
  { code: "INR", aliases: ["rs", "rs.", "inr", "rupees", "rupee"] },
];

const ensureDir = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const normalizeCropRectInput = (cropRect) => {
  if (!cropRect || typeof cropRect !== "object") return null;
  const x = Number(cropRect.x);
  const y = Number(cropRect.y);
  const width = Number(cropRect.width);
  const height = Number(cropRect.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;

  const left = Math.max(0, Math.min(100, x));
  const top = Math.max(0, Math.min(100, y));
  const normalizedWidth = Math.max(0, Math.min(100 - left, width));
  const normalizedHeight = Math.max(0, Math.min(100 - top, height));
  if (normalizedWidth < 2 || normalizedHeight < 2) return null;

  return {
    x: Number(left.toFixed(2)),
    y: Number(top.toFixed(2)),
    width: Number(normalizedWidth.toFixed(2)),
    height: Number(normalizedHeight.toFixed(2)),
  };
};

const uniqueCommandEntries = (entries) => {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.command}::${(entry.args || []).join(" ")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const commandExists = (command) => {
  if (!command) return false;
  if (command.includes("\\") || command.includes("/") || command.endsWith(".exe")) {
    return fs.existsSync(command);
  }
  return true;
};

const collectExistingPythonPaths = (baseDir) => {
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
};

const getPythonCommands = () => {
  if (DISABLE_PYTHON_OCR) {
    return [];
  }
  if (process.platform === "win32") {
    const envPythonCandidates = [
      process.env.EXPENSE_OCR_PYTHON_EXEC,
      process.env.OCR_PYTHON_EXEC,
      process.env.PYTHON_EXECUTABLE,
    ].filter(Boolean).map((command) => ({ command, args: [] }));
    const discoveredPythonCandidates = [
      ...collectExistingPythonPaths(path.join(process.env.LOCALAPPDATA || "", "Programs", "Python")),
      ...collectExistingPythonPaths(path.join(process.env.ProgramFiles || "", "Python")),
      ...collectExistingPythonPaths(path.join(process.env["ProgramFiles(x86)"] || "", "Python")),
    ].map((command) => ({ command, args: [] }));
    const windowsCandidates = [
      ...envPythonCandidates,
      { command: LOCAL_OCR_PYTHON_CMD, args: [] },
      { command: "C:\\Python314\\python.exe", args: [] },
      ...discoveredPythonCandidates,
      { command: "py", args: ["-3.14"] },
      { command: "C:\\Windows\\py.exe", args: ["-3.14"] },
      { command: "python", args: [] },
      { command: "python.exe", args: [] },
      { command: "py", args: ["-3"] },
      { command: "py", args: [] },
      { command: "C:\\Windows\\py.exe", args: ["-3"] },
      { command: "C:\\Windows\\py.exe", args: [] },
    ];

    const localPython = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "python3.exe")
      : "";

    if (localPython) {
      windowsCandidates.push({ command: localPython, args: [] });
    }

    return uniqueCommandEntries(windowsCandidates).filter((entry) => commandExists(entry.command));
  }

  return [
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ].filter((entry) => commandExists(entry.command));
};

const getSpawnEnv = () => {
  const env = { ...process.env };
  if (process.platform === "win32" && fs.existsSync(WINDOWS_TESSERACT_DIR)) {
    env.PATH = env.PATH ? `${env.PATH};${WINDOWS_TESSERACT_DIR}` : WINDOWS_TESSERACT_DIR;
    if (fs.existsSync(WINDOWS_TESSERACT_CMD)) {
      env.TESSERACT_CMD = WINDOWS_TESSERACT_CMD;
    }
  }
  return env;
};

const extractJsonPayload = (rawText) => {
  const text = String(rawText || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON payload found in Python output");
  }
  return JSON.parse(text.slice(start, end + 1));
};

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const runPythonJsonScript = (scriptPath, scriptArgs = [], options = {}) =>
  new Promise((resolve, reject) => {
    const commands = getPythonCommands();
    const errors = [];
    const timeoutMs = Number(options.timeoutMs || OCR_TIMEOUT_MS);

    const attempt = (index) => {
      if (index >= commands.length) {
        reject(new Error(errors.join(" | ") || "No Python runtime was available"));
        return;
      }

      const candidate = commands[index];
      const child = spawn(candidate.command, [...candidate.args, scriptPath, ...scriptArgs], {
        cwd: options.cwd || path.join(__dirname, ".."),
        stdio: ["ignore", "pipe", "pipe"],
        env: getSpawnEnv(),
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk || "");
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        errors.push(`${candidate.command} ${candidate.args.join(" ")}: ${error.message}`.trim());
        attempt(index + 1);
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch (error) {
          // ignore kill failure
        }
        errors.push(`${candidate.command} ${candidate.args.join(" ")}: timed out after ${timeoutMs}ms`);
        attempt(index + 1);
      }, timeoutMs);

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (code !== 0) {
          errors.push(
            `${candidate.command} ${candidate.args.join(" ")}: ${stderr.trim() || `script exited with code ${code}`}`.trim()
          );
          attempt(index + 1);
          return;
        }

        try {
          resolve(extractJsonPayload(stdout));
        } catch (error) {
          reject(new Error(`Failed to parse Python JSON output: ${error.message}`));
        }
      });
    };

    attempt(0);
  });

const runPythonProcessor = (imagePath, options = {}) =>
  new Promise((resolve, reject) => {
    ensureDir(OCR_TMP_ROOT);
    const workDir = fs.mkdtempSync(path.join(OCR_TMP_ROOT, "job-"));
    const payload = {
      imagePath,
      workDir,
      cropRect: options.cropRect || null,
      rotation: Number(options.rotation || 0),
      brightness: Number(options.brightness || 100),
      contrast: Number(options.contrast || 100),
    };

    const scriptPath = path.join(__dirname, "..", "scripts", "expense_receipt_processor.py");
    const commands = getPythonCommands();
    const errors = [];

    const attempt = (index) => {
      if (index >= commands.length) {
        safeUnlink(workDir);
        reject(new Error(errors.join(" | ") || "No Python runtime was available for OCR preprocessing"));
        return;
      }

      const candidate = commands[index];
      const child = spawn(candidate.command, [...candidate.args, scriptPath, JSON.stringify(payload)], {
        cwd: path.join(__dirname, ".."),
        stdio: ["ignore", "pipe", "pipe"],
        env: getSpawnEnv(),
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk || "");
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        errors.push(`${candidate.command} ${candidate.args.join(" ")}: ${error.message}`.trim());
        attempt(index + 1);
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch (error) {
          // ignore kill failure
        }
        errors.push(`${candidate.command} ${candidate.args.join(" ")}: timed out after ${OCR_TIMEOUT_MS}ms`);
        attempt(index + 1);
      }, OCR_TIMEOUT_MS);

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (code !== 0) {
          errors.push(
            `${candidate.command} ${candidate.args.join(" ")}: ${stderr.trim() || `processor exited with code ${code}`}`.trim()
          );
          attempt(index + 1);
          return;
        }

        try {
          resolve({
            ...JSON.parse(stdout),
            workDir,
          });
        } catch (error) {
          reject(new Error(`Failed to parse receipt processor output: ${error.message}`));
        }
      });
    };

    attempt(0);
  });

const runMlFieldExtractor = async (imagePath, options = {}) => {
  const disablePython = Boolean(options.disablePython || DISABLE_PYTHON_OCR);
  const disableMl = Boolean(options.disableMl || DISABLE_ML_OCR);
  if (disablePython || disableMl) {
    return null;
  }
  if (!fs.existsSync(EXPENSE_ML_SCRIPT_PATH) || !fs.existsSync(EXPENSE_ML_MODEL_PATH)) {
    return null;
  }

  return runPythonJsonScript(
    EXPENSE_ML_SCRIPT_PATH,
    [
      "--image",
      imagePath,
      "--model",
      EXPENSE_ML_MODEL_PATH,
      "--category-model",
      EXPENSE_CATEGORY_MODEL_PATH,
      ...(options.cropRect ? ["--crop-rect", JSON.stringify(options.cropRect)] : []),
    ],
    {
      cwd: EXPENSE_ML_ROOT,
      timeoutMs: OCR_ML_TIMEOUT_MS,
    }
  );
};

const safeUnlink = (targetPath) => {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (error) {
    // Cleanup is best-effort.
  }
};

const isPdfFile = (targetPath) => path.extname(String(targetPath || "")).toLowerCase() === ".pdf";

const getImageDimensions = (targetPath) => {
  try {
    const buffer = fs.readFileSync(targetPath);
    if (buffer.length < 24) return null;

    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    if (isPng) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    if (isJpeg) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const marker = buffer[offset + 1];
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }

        const size = buffer.readUInt16BE(offset + 2);
        if (!Number.isFinite(size) || size < 2) break;
        offset += 2 + size;
      }
    }
  } catch (error) {
    return null;
  }

  return null;
};

const normalizeLine = (line) =>
  String(line || "")
    .replace(/\s+/g, " ")
    .replace(/[|]/g, "I")
    .replace(/[Ã¢â€šÂ¹â‚¹]/g, "Rs ")
    .trim();

const normalizeToken = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());

const normalizePredictedCategory = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const mapPredictedCategoryToExpenseCategory = (value) => {
  const normalized = normalizePredictedCategory(value);
  const mapped = APP_EXPENSE_CATEGORY_MAP[normalized] || "";
  if (!mapped) return "";
  return AUTO_ASSIGNABLE_EXPENSE_CATEGORIES.has(mapped) ? mapped : "other";
};

const scoreCategoryTerms = (normalizedText, terms) =>
  terms.reduce((score, term) => {
    const normalizedTerm = normalizeToken(term);
    if (!normalizedTerm || !normalizedText.includes(normalizedTerm)) {
      return score;
    }
    return score + Math.max(1, normalizedTerm.split(" ").length * 2);
  }, 0);

const scoreCategoryLineHits = (lines, terms) =>
  lines.reduce((score, line) => {
    const normalizedLine = normalizeToken(line);
    if (!normalizedLine) return score;

    let lineScore = 0;
    terms.forEach((term) => {
      const normalizedTerm = normalizeToken(term);
      if (!normalizedTerm || !normalizedLine.includes(normalizedTerm)) return;
      lineScore += Math.max(2, normalizedTerm.split(" ").length * 3);
    });

    return score + Math.min(lineScore, 8);
  }, 0);

const predictCategoryFromReceiptContent = ({ lines = [], fields = {} }) => {
  const vendor = String(fields.vendorName || "").trim();
  const description = String(fields.description || "").trim();
  const textBlob = [vendor, description, ...lines].filter(Boolean).join(" ");
  const normalizedText = normalizeToken(textBlob);
  if (!normalizedText) {
    return null;
  }

  const scores = Object.entries(CATEGORY_KEYWORDS).reduce((acc, [category, terms]) => {
    acc[category] = scoreCategoryTerms(normalizedText, terms) + scoreCategoryLineHits(lines, terms);
    return acc;
  }, {});
  const otherScores = Object.entries(OTHER_CATEGORY_KEYWORDS).reduce((acc, [category, terms]) => {
    acc[category] = scoreCategoryTerms(normalizedText, terms) + scoreCategoryLineHits(lines, terms);
    return acc;
  }, {});

  const explicitCategoryLine = lines.find((line) => /\b(category|expense type|account head)\b/i.test(line));
  if (explicitCategoryLine) {
    const normalizedExplicit = normalizeToken(explicitCategoryLine);
    Object.entries(CATEGORY_KEYWORDS).forEach(([category, terms]) => {
      if (terms.some((term) => normalizedExplicit.includes(normalizeToken(term)))) {
        scores[category] += 8;
      }
    });
  }

  const vendorDescriptionBlob = normalizeToken([vendor, description].filter(Boolean).join(" "));
  Object.entries(CATEGORY_KEYWORDS).forEach(([category, terms]) => {
    if (terms.some((term) => vendorDescriptionBlob.includes(normalizeToken(term)))) {
      scores[category] += 5;
    }
  });

  const hasHotelWord = /\bhotel\b/i.test(textBlob);
  const hasLodgingSignal = CATEGORY_KEYWORDS.hotel.some((term) =>
    normalizedText.includes(normalizeToken(term))
  );
  const hasFoodSignal = CATEGORY_KEYWORDS.food.some((term) =>
    normalizedText.includes(normalizeToken(term))
  );

  if (hasHotelWord && !hasLodgingSignal) {
    scores.food += 2;
  }
  if (hasHotelWord && hasFoodSignal && !hasLodgingSignal) {
    scores.food += 4;
  }

  if (CATEGORY_KEYWORDS.food.some((term) => normalizedText.includes(normalizeToken(term)))) {
    scores.food += 2;
  }
  if (CATEGORY_KEYWORDS.medical.some((term) => normalizedText.includes(normalizeToken(term)))) {
    otherScores.medical += 2;
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);
  const rankedOther = Object.entries(otherScores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 && rankedOther.length === 0) {
    return null;
  }

  if (ranked.length > 1 && ranked[0][1] < ranked[1][1] + 2) {
    return null;
  }

  const [category, score] = ranked[0] || [];
  const [otherCategory, otherScore] = rankedOther[0] || [];
  const topOtherIsStronger = otherCategory && Number(otherScore || 0) >= Number(score || 0) + 3;
  const chosenCategory = topOtherIsStronger ? otherCategory : category;
  const chosenScore = topOtherIsStronger ? otherScore : score;
  if (!chosenCategory || !chosenScore) {
    return null;
  }

  const mappedCategory = mapPredictedCategoryToExpenseCategory(chosenCategory);
  const confidence = clampConfidence(55 + Math.min(chosenScore * 8, 35));
  return {
    predictedCategory: titleCase(chosenCategory),
    suggestedExpenseCategory: mappedCategory || "other",
    confidence,
    customCategoryLabel: (!mappedCategory && chosenCategory !== "other") ? titleCase(chosenCategory) : "",
    customCategoryConfidence: mappedCategory ? 0 : confidence,
  };
};

const dedupeLines = (lines) => {
  const seen = new Set();
  const output = [];
  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const hasAnyTerm = (value, terms) => {
  const normalized = normalizeToken(value);
  return terms.some((term) => normalized.includes(normalizeToken(term)));
};

const detectDocumentStyle = (lines) => {
  const normalizedBlob = normalizeToken(lines.join("\n"));
  const hitCount = PAYMENT_SCREENSHOT_TERMS.filter((term) =>
    normalizedBlob.includes(normalizeToken(term))
  ).length;
  return hitCount >= 2 ? "payment_screenshot" : "receipt";
};

const hasCurrencyCue = (value, documentStyle = "receipt") => {
  const baseRegex = /(?:\brs\.?|inr|rupees?|rupee)/i;
  if (baseRegex.test(String(value || ""))) return true;
  return false;
};

const detectCurrencyFromText = (value) => {
  const source = String(value || "");
  if (/\b(?:food|grand|net|bill|final)?\s*total\b/i.test(source) && !hasCurrencyCue(source)) {
    return "";
  }
  const normalized = normalizeToken(source);
  const normalizedWords = normalized.split(" ").filter(Boolean);
  const normalizedWordSet = new Set(normalizedWords);

  for (const entry of CURRENCY_DEFINITIONS) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeToken(alias);
      if (!normalizedAlias) continue;
      if (
        normalizedWordSet.has(normalizedAlias) ||
        (normalizedAlias.includes(" ") && normalized.includes(normalizedAlias))
      ) {
        return "INR";
      }
    }
  }

  if (/\b(?:rs|inr|rupees?|rupee)\b/i.test(source)) return "INR";
  return "";
};

const normalizeDetectedCurrencyCode = () => "INR";

const compactOcrAmountText = (value) =>
  String(value || "")
    .replace(/[^\d.,\s-]/g, "")
    .replace(/(?<=\d)\s+(?=[\d.,])/g, "")
    .replace(/(?<=[.,])\s+(?=\d)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const parseAmountValue = (value) => {
  if (!value) return null;
  let cleaned = compactOcrAmountText(value).replace(/\s+/g, "");
  if (!cleaned) return null;

  cleaned = cleaned.replace(/(?<=\d)[.,]\s*$/, ".00");
  if (/^-?\d+\.\d$/.test(cleaned)) {
    cleaned = `${cleaned}0`;
  }

  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if ((cleaned.match(/,/g) || []).length === 1 && !cleaned.includes(".")) {
    if (/(,\d{2})$/.test(cleaned)) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const amountRegex = /(?:\brs\.?|inr|usd|\$|eur|aed|sgd|gbp|cad|aud|jpy|₹|â‚¹|Ã¢â€šÂ¹)?\s*-?\d[\d,]*\.?\d{0,2}/gi;

const buildPaymentArtifactAmountVariants = (rawValue, documentStyle = "receipt") => {
  const parsedAmount = parseAmountValue(rawValue);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > OCR_MAX_REASONABLE_TOTAL) {
    return [];
  }

  const variants = [{
    raw: rawValue,
    amount: parsedAmount,
    currency: detectCurrencyFromText(rawValue),
    artifactAdjusted: false,
  }];

  if (documentStyle !== "payment_screenshot" || hasCurrencyCue(rawValue, documentStyle)) {
    return variants;
  }

  const compactRaw = compactOcrAmountText(rawValue).replace(/\s+/g, "");
  if (!/^2\d{3,6}(?:\.\d{1,2})?$/.test(compactRaw)) {
    return variants;
  }

  const alternateAmount = parseAmountValue(compactRaw.slice(1));
  if (
    Number.isFinite(alternateAmount) &&
    alternateAmount >= 10 &&
    alternateAmount <= OCR_MAX_REASONABLE_TOTAL
  ) {
    variants.push({
      raw: rawValue,
      amount: alternateAmount,
      currency: "INR",
      artifactAdjusted: true,
    });
  }

  return variants;
};

const extractSplitCurrencyAmount = (line, documentStyle = "receipt") => {
  const source = String(line || "");
  if (!hasCurrencyCue(source, documentStyle)) return null;

  const regex = documentStyle === "payment_screenshot"
    ? /(?:\brs\.?|inr|₹|â‚¹|Ã¢â€šÂ¹|ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹|(?:\b[FR]|[?£]))\s*([-]?\d{1,3}(?:[\s,]*\d{2,3})*(?:\.\s*\d{1,2})?)/i
    : /(?:\brs\.?|inr|₹|â‚¹|Ã¢â€šÂ¹|ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹)\s*([-]?\d{1,3}(?:[\s,]*\d{2,3})*(?:\.\s*\d{1,2})?)/i;

  const match = source.match(regex);
  if (!match) return null;

  const compacted = match[1]
    .replace(/(?<=\d)\s+(?=[\d.,])/g, "")
    .replace(/\.\s+/g, ".")
    .trim();
  const amount = parseAmountValue(compacted);
  if (!Number.isFinite(amount) || amount <= 0 || amount > OCR_MAX_REASONABLE_TOTAL) return null;

  return {
    raw: match[0],
    amount,
    currency: detectCurrencyFromText(match[0]) || detectCurrencyFromText(line) || "INR",
    source: "split_currency_amount",
  };
};

const extractAmountsFromLine = (line, documentStyle = "receipt") => {
  const source = String(line || "");
  const amounts = Array.from(source.matchAll(amountRegex))
    .flatMap((match) => {
      const rawMatch = String(match?.[0] || "");
      const startIndex = Number(match?.index || 0);
      const endIndex = startIndex + rawMatch.length;
      const prevChar = source[startIndex - 1] || "";
      const nextChar = source[endIndex] || "";
      const hasEmbeddedAlphaNumericNeighbor =
        !hasCurrencyCue(rawMatch, documentStyle) &&
        (/[a-z]/i.test(prevChar) || /[a-z]/i.test(nextChar));

      if (hasEmbeddedAlphaNumericNeighbor) return [];

      return buildPaymentArtifactAmountVariants(rawMatch, documentStyle).map((variant) => ({
        raw: rawMatch,
        amount: variant.amount,
        currency: variant.currency || detectCurrencyFromText(rawMatch) || detectCurrencyFromText(line),
        artifactAdjusted: Boolean(variant.artifactAdjusted),
      }));
    })
    .filter(Boolean);

  const spacedMatches = source.match(/(?:\b(?:rs\.?|inr)\b\s*)?-?\d[\d,\s]{1,}\d(?:\.\s*\d{1,2})?/gi) || [];
  spacedMatches.forEach((rawMatch) => {
    const variants = buildPaymentArtifactAmountVariants(rawMatch, documentStyle);
    variants.forEach((variant) => {
      if (!Number.isFinite(variant.amount) || variant.amount < 0 || variant.amount > OCR_MAX_REASONABLE_TOTAL) return;
      if (amounts.some((item) => Math.abs(Number(item.amount) - Number(variant.amount)) < 0.001)) return;
      amounts.push({
        raw: rawMatch,
        amount: variant.amount,
        currency: variant.currency || detectCurrencyFromText(rawMatch) || detectCurrencyFromText(line),
        artifactAdjusted: Boolean(variant.artifactAdjusted),
      });
    });
  });

  const splitCurrencyAmount = extractSplitCurrencyAmount(line, documentStyle);
  if (
    splitCurrencyAmount &&
    !amounts.some((item) => Math.abs(Number(item.amount) - Number(splitCurrencyAmount.amount)) < 0.001)
  ) {
    amounts.unshift(splitCurrencyAmount);
  }

  return amounts;
};

const isFinalTotalLikeLine = (line) =>
  /(grand total|net total|invoice total|bill total|final total|total amount|amount paid|paid amount|amount due|amount payable|net payable|payable amount|you paid|money sent|money received|payment to|debited from|received from|paid to)/i.test(
    String(line || "")
  );

const isPlainTotalLine = (line) =>
  /(^|\b)total(\b|$)/i.test(String(line || "")) &&
  !/(subtotal|sub total|tax|gst|cgst|sgst|igst|item total|base amount|taxable amount|net amount)/i.test(String(line || ""));

const isSuspiciousAmountLine = (line) =>
  /(available balance|closing balance|bank balance|wallet balance|balance|utr|ref(?:erence)? no|transaction id|txn id|upi transaction id|google transaction id|date|time|mobile|phone|account|a\/c|ending|rrn)/i.test(
    String(line || "")
  );

const isAmountTableNoiseLine = (line) =>
  /\b(?:qty|quantity|rate|mrp|price|unit price|amount|taxable value|hsn|sac|discount|item|particulars)\b/i.test(
    String(line || "")
  );

const getAmountNeighborContext = (lines, index) => {
  const previousLine = String(lines[index - 1] || "");
  const currentLine = String(lines[index] || "");
  const nextLine = String(lines[index + 1] || "");
  const joined = [previousLine, currentLine, nextLine].filter(Boolean).join(" ");

  return {
    previousLine,
    currentLine,
    nextLine,
    joined,
    previousLooksLikeTotalLabel:
      (isFinalTotalLikeLine(previousLine) || isPlainTotalLine(previousLine)) &&
      !extractAmountsFromLine(previousLine).length,
    nextLooksLikeTotalLabel:
      (isFinalTotalLikeLine(nextLine) || isPlainTotalLine(nextLine)) &&
      !extractAmountsFromLine(nextLine).length,
    nearbyHasTotalSignal:
      isFinalTotalLikeLine(joined) ||
      isPlainTotalLine(joined) ||
      /\b(?:grand|final|net|invoice|bill|amount paid|payable|due)\b/i.test(joined),
    nearbyHasSubtotalSignal: /\b(?:subtotal|sub total|taxable amount|base amount|item total|net amount)\b/i.test(joined),
    nearbyHasTaxSignal: /\b(?:gst|cgst|sgst|igst|vat|sales tax|tax amount|tax)\b/i.test(joined),
  };
};

const buildAmountCandidates = (lines, documentStyle) => {
  const candidates = [];
  const normalizedBlob = normalizeToken(lines.join("\n"));
  const hasPaymentCompletionContext = /(completed|successful|success|paid|pay again|money sent|debited|credited|upi transaction id|google transaction id|transaction id)/i.test(
    normalizedBlob
  );
  const hasPetrolContext = /(petrol|diesel|fuel|indianoil|bharat petroleum|hpcl|nayara|reliance petroleum)/i.test(
    normalizedBlob
  );
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const amounts = extractAmountsFromLine(line, documentStyle);
    if (amounts.length === 0) return;
    const neighborContext = getAmountNeighborContext(lines, index);

    amounts.forEach(({ amount, currency, raw }) => {
      let label = "amount";
      let score = 0.35;
      const explicitCurrencyAmount = hasCurrencyCue(raw, documentStyle);
      const compactAmountLine = /^[^\d]{0,8}\d[\d,]*\.?\d{0,2}\s*$/i.test(line.trim());
      const finalTotalLike = isFinalTotalLikeLine(line);
      const plainTotalLike = isPlainTotalLine(line);

      if (/(grand total|net total|invoice total|bill total|food total|final total|total amount|amount paid|paid amount|amount due|amount payable|net payable|payable amount)/i.test(lower)) {
        label = "total";
        score = 1.02;
      } else if (/(^|\b)total(\b|$)/i.test(lower) && !/(subtotal|sub total|tax|gst|cgst|sgst|igst|item total|base amount|taxable amount|net amount)/i.test(lower)) {
        label = "total";
        score = 0.91;
      } else if (/(subtotal|sub total|taxable amount|base amount|item total|net amount)/i.test(lower)) {
        label = "subtotal";
        score = 0.78;
      } else if (/(gst|cgst|sgst|igst|vat|sales tax|tax amount|tax\b)/i.test(lower)) {
        label = "gst";
        score = 0.83;
      } else if (/(paid|debited|received)/i.test(lower)) {
        label = "total";
        score = 0.74;
      }

      if (hasPetrolContext && /(^|\b)sale(\b|$)/i.test(lower)) {
        label = "total";
        score = 1.05;
      }

      if (label === "amount" && neighborContext.previousLooksLikeTotalLabel) {
        label = "total";
        score = Math.max(score, 1.03);
      } else if (label === "amount" && neighborContext.nextLooksLikeTotalLabel) {
        label = "total";
        score = Math.max(score, 0.96);
      } else if (label === "amount" && compactAmountLine && neighborContext.nearbyHasTotalSignal) {
        label = "total";
        score = Math.max(score, 0.88);
      }

      if (neighborContext.nearbyHasSubtotalSignal && !neighborContext.nearbyHasTotalSignal) {
        if (label === "amount") {
          label = "subtotal";
          score = Math.max(score, 0.8);
        } else if (label !== "total") {
          score = Math.min(score, 0.8);
        }
      }

      if (neighborContext.nearbyHasTaxSignal && !neighborContext.nearbyHasTotalSignal) {
        label = "gst";
        score = Math.max(score, 0.84);
      }

      if (documentStyle === "payment_screenshot") {
        if (/(paid to|you paid|money sent|payment to|debited from|received from|amount paid|transferred)/i.test(lower)) {
          label = "total";
          score = Math.max(score, 0.94);
        }
        if (/(google pay|gpay|phonepe|paytm|upi)/i.test(lower) && explicitCurrencyAmount) {
          label = "total";
          score = Math.max(score, 0.98);
        }
        if (explicitCurrencyAmount && (compactAmountLine || index <= 8) && hasPaymentCompletionContext) {
          label = "total";
          score = Math.max(score, 1.08 - Math.min(index, 8) * 0.02);
        }
        if (!explicitCurrencyAmount && compactAmountLine && index <= 6 && hasPaymentCompletionContext) {
          label = "total";
          score = Math.max(score, 0.86 - index * 0.02);
        }
        if (compactAmountLine && explicitCurrencyAmount && index <= 4) {
          label = "total";
          score = Math.max(score, 1.1 - index * 0.02);
        }
        if (/(available balance|closing balance|bank balance|wallet balance|balance)/i.test(lower)) {
          score -= 1.20; // Heavily penalize balance so it's never chosen as total
        }
        if (/(utr|ref(?:erence)? no|transaction id|txn id|upi transaction id|google transaction id|rrn|mobile|phone|account|a\/c|ending)/i.test(lower)) {
          score -= 0.18;
        }
      }

      if (label === "total") {
        score += Math.min(index / Math.max(lines.length, 1), 0.22);
        // Boost score for totals with currency symbols (prioritize Rs, ₹, etc.)
        if (explicitCurrencyAmount) {
          score += 0.15;
        } else if (documentStyle === "payment_screenshot") {
          // Never allow a non-explicit currency amount to exceed 89 confidence on a payment screenshot,
          // because it's likely a date year or phone number if it lacks a currency symbol.
          score = Math.min(score, 0.89);
        }
      }

      if (label === "amount" && isAmountTableNoiseLine(line) && !compactAmountLine) {
        score -= 0.2;
      }
      if (label === "amount" && compactAmountLine && index > 0 && isAmountTableNoiseLine(lines[index - 1] || "")) {
        score -= 0.14;
      }

      if (/(cashback|reward|points|discount|saved|fee|charge)/i.test(lower) && amount < 1000) {
        score -= 0.14;
      }

      candidates.push({
        line,
        lineIndex: index,
        label,
        amount,
        raw,
        currency,
        score,
        explicitCurrencyAmount,
        compactAmountLine,
        finalTotalLike,
        plainTotalLike,
      });
    });
  });

  return candidates;
};

const chooseBestCandidate = (candidates, label) =>
  [...candidates]
    .filter((candidate) => candidate.label === label)
    .sort((a, b) => b.score - a.score || b.amount - a.amount || a.lineIndex - b.lineIndex)[0] || null;

const chooseLastProminentTotalCandidate = (candidates, documentStyle = "receipt") => {
  const totals = [...candidates].filter((candidate) => {
    if (candidate.label !== "total") return false;
    if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return false;
    if (isSuspiciousAmountLine(candidate.line)) return false;

    if (documentStyle === "payment_screenshot") {
      return Boolean(
        candidate.finalTotalLike ||
        (candidate.explicitCurrencyAmount && candidate.compactAmountLine) ||
        candidate.score >= 0.98
      );
    }

    return Boolean(
      candidate.finalTotalLike ||
      (candidate.plainTotalLike && candidate.explicitCurrencyAmount) ||
      candidate.score >= 0.98
    );
  });

  if (totals.length === 0) return null;

  return totals.sort((a, b) =>
    Number(b.finalTotalLike) - Number(a.finalTotalLike) ||
    Number(b.explicitCurrencyAmount) - Number(a.explicitCurrencyAmount) ||
    Number(b.compactAmountLine) - Number(a.compactAmountLine) ||
    b.lineIndex - a.lineIndex ||
    b.score - a.score ||
    b.amount - a.amount
  )[0] || null;
};

const chooseBestTotalCandidate = (candidates, documentStyle = "receipt") => {
  const totals = [...candidates].filter((candidate) => candidate.label === "total");
  if (totals.length === 0) {
    if (documentStyle === "payment_screenshot") {
      const validAmounts = [...candidates].filter(c => c.amount > 0 && !isSuspiciousAmountLine(c.line));
      if (validAmounts.length > 0) {
        return validAmounts.sort((a, b) => b.score - a.score || b.amount - a.amount)[0] || null;
      }
    }
    return null;
  }

  const trailingProminentTotal = chooseLastProminentTotalCandidate(totals, documentStyle);
  if (trailingProminentTotal) {
    return trailingProminentTotal;
  }

  if (documentStyle === "payment_screenshot") {
    return totals.sort((a, b) =>
      b.score - a.score ||
      Number(b.finalTotalLike || b.plainTotalLike) - Number(a.finalTotalLike || a.plainTotalLike) ||
      Number(hasCurrencyCue(b.raw || b.line || "", documentStyle)) - Number(hasCurrencyCue(a.raw || a.line || "", documentStyle)) ||
      b.amount - a.amount ||
      b.lineIndex - a.lineIndex ||
      Number(isFinalTotalLikeLine(b.line)) - Number(isFinalTotalLikeLine(a.line))
    )[0] || null;
  }

  return totals.sort((a, b) =>
    Number(isFinalTotalLikeLine(b.line) || isPlainTotalLine(b.line)) - Number(isFinalTotalLikeLine(a.line) || isPlainTotalLine(a.line)) ||
    b.score - a.score ||
    Number(b.explicitCurrencyAmount) - Number(a.explicitCurrencyAmount) ||
    b.lineIndex - a.lineIndex ||
    b.amount - a.amount
  )[0] || null;
};

const chooseReceiptTrailingTotalFallback = (candidates, subtotalCandidate = null) => {
  const subtotalAmount = Number(subtotalCandidate?.amount || 0);
  const subtotalLineIndex = Number.isInteger(subtotalCandidate?.lineIndex) ? subtotalCandidate.lineIndex : -1;

  return [...candidates]
    .filter((candidate) => {
      if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return false;
      if (candidate.label === "gst") return false;
      if (isSuspiciousAmountLine(candidate.line)) return false;
      if (subtotalLineIndex >= 0 && candidate.lineIndex < subtotalLineIndex) return false;
      if (subtotalAmount > 0 && candidate.amount + 0.009 < subtotalAmount) return false;
      if (subtotalAmount > 0 && candidate.amount > subtotalAmount * 1.35 + 5000) return false;
      return isFinalTotalLikeLine(candidate.line) || isPlainTotalLine(candidate.line) || candidate.score >= 0.88;
    })
    .sort((a, b) =>
      Number(isFinalTotalLikeLine(b.line) || isPlainTotalLine(b.line)) - Number(isFinalTotalLikeLine(a.line) || isPlainTotalLine(a.line)) ||
      b.lineIndex - a.lineIndex ||
      b.score - a.score ||
      b.amount - a.amount
    )[0] || null;
};

const recoverTruncatedTotalCandidate = (candidates, chosenTotal, subtotalCandidate = null, documentStyle = "receipt") => {
  if (!chosenTotal || !Number.isFinite(Number(chosenTotal.amount))) return null;
  const chosenAmount = Number(chosenTotal.amount);
  if (chosenAmount <= 0) return null;

  const subtotalAmount = Number(subtotalCandidate?.amount || 0);
  const needsRecovery =
    (subtotalAmount > 0 && chosenAmount + 0.009 < subtotalAmount) ||
    chosenAmount < 1000;
  if (!needsRecovery) return null;

  const alternatives = [...candidates]
    .filter((candidate) => {
      if (!Number.isFinite(candidate.amount) || candidate.amount <= chosenAmount) return false;
      if (isSuspiciousAmountLine(candidate.line)) return false;
      if (!(candidate.label === "total" || isFinalTotalLikeLine(candidate.line) || isPlainTotalLine(candidate.line))) return false;
      if (subtotalAmount > 0 && candidate.amount + 0.009 < subtotalAmount) return false;

      const roughlyTenTimes = candidate.amount >= chosenAmount * 9.5 && candidate.amount <= chosenAmount * 10.5;
      const sameLeadingDigits =
        String(Math.round(candidate.amount)).startsWith(String(Math.round(chosenAmount))) ||
        String(Math.round(chosenAmount)).startsWith(String(Math.round(candidate.amount)));

      return roughlyTenTimes || sameLeadingDigits;
    })
    .sort((a, b) =>
      Number(isFinalTotalLikeLine(b.line) || isPlainTotalLine(b.line)) - Number(isFinalTotalLikeLine(a.line) || isPlainTotalLine(a.line)) ||
      Number(b.explicitCurrencyAmount) - Number(a.explicitCurrencyAmount) ||
      b.score - a.score ||
      b.amount - a.amount ||
      a.lineIndex - b.lineIndex
    );

  const bestAlternative = alternatives[0] || null;
  if (!bestAlternative) return null;

  const chosenLooksWeak =
    chosenTotal.score < 0.98 ||
    !chosenTotal.explicitCurrencyAmount ||
    (documentStyle === "receipt" && !isFinalTotalLikeLine(chosenTotal.line) && !isPlainTotalLine(chosenTotal.line));

  if (!chosenLooksWeak && bestAlternative.score < chosenTotal.score + 0.05) {
    return null;
  }

  return bestAlternative;
};

const datePatterns = [
  // Added dot separators [./-]
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
  // Added optional ordinal suffixes (st|nd|rd|th) and flexible glued spacing [\s,.-]*
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,.-]*\d{1,2}(?:st|nd|rd|th)?[\s,.-]+\d{2,4}\b/gi,
  /\b\d{1,2}(?:st|nd|rd|th)?[\s,.-]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,.-]*\d{2,4}\b/gi,
];

const padDatePart = (value) => String(value).padStart(2, "0");

const getMaxReasonableReceiptYear = () => new Date().getFullYear() + 2;

const isReasonableReceiptYear = (year) =>
  Number.isInteger(year) && year >= 2018 && year <= getMaxReasonableReceiptYear();

const isValidCalendarDate = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (!isReasonableReceiptYear(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
};

const formatDateParts = (year, month, day) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || !Number.isInteger(numericDay)) {
    return null;
  }
  if (!isValidCalendarDate(numericYear, numericMonth, numericDay)) {
    return null;
  }
  return `${numericYear}-${padDatePart(numericMonth)}-${padDatePart(numericDay)}`;
};

const parseDateValue = (rawValue) => {
  const source = String(rawValue || "").trim();
  if (!source) return null;

  // Added dot separator support in the parsing logic as well
  const normalized = source.replace(/(\d)(st|nd|rd|th)(?![a-z])/gi, "$1");
  const isoMatch = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (isoMatch) {
    return formatDateParts(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const slashMatch = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (slashMatch) {
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return formatDateParts(year, month, day);
  }

  const monthLike = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/i.test(normalized);
  if (!monthLike) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  const parsedYear = parsed.getFullYear();
  const parsedMonth = parsed.getMonth() + 1;
  const parsedDay = parsed.getDate();
  if (!isValidCalendarDate(parsedYear, parsedMonth, parsedDay)) return null;
  return formatDateParts(parsedYear, parsedMonth, parsedDay);
};

const extractDateCandidate = (lines) => {
  const found = [];
  lines.forEach((line, index) => {
    for (const pattern of datePatterns) {
      const matches = line.match(pattern) || [];
      matches.forEach((match) => {
        const parsed = parseDateValue(match);
        if (!parsed) return;

        let score = 0.72;
        if (/(date|invoice date|txn date|transaction date|paid on|created on|updated on|at \d{1,2}:\d{2})/i.test(line)) {
          score = 0.92;
        }
        if (/(due date|expiry|valid till|scheduled)/i.test(line)) {
          score -= 0.16;
        }

        const parsedYear = Number(String(parsed).slice(0, 4));
        if (parsedYear < 2019 || parsedYear > 2100) {
          score -= 0.25;
        }

        found.push({
          value: parsed,
          raw: match,
          score,
          lineIndex: index,
          line,
        });
      });
    }
  });

  return found.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex)[0] || null;
};

const noiseTokens = [
  "receipt",
  "invoice",
  "bill",
  "tax",
  "gst",
  "cgst",
  "sgst",
  "igst",
  "date",
  "time",
  "phone",
  "upi",
  "transaction",
  "payment",
  "order",
  "subtotal",
  "total",
  "t no",
  "tno",
  "emp",
  "emp no",
  "employee no",
  "table",
  "particulars",
  "qty",
  "quantity",
  "rate",
  "amount",
];

const vendorAddressTerms = [
  "road",
  "rd",
  "street",
  "st",
  "lane",
  "ln",
  "nagar",
  "floor",
  "building",
  "chambers",
  "complex",
  "tower",
  "plaza",
  "society",
  "apartment",
  "apt",
  "suite",
  "office",
  "branch",
  "near",
  "opp",
  "pune",
  "mumbai",
  "bangalore",
  "bengaluru",
  "delhi",
  "india",
];

const vendorHeaderTerms = [
  "tax invoice",
  "invoice",
  "receipt",
  "cash memo",
  "retail invoice",
  "gst invoice",
  "bill no",
  "bill",
];

const vendorRejectTerms = [
  "computerized generated",
  "computer generated",
  "customer copy",
  "merchant copy",
  "duplicate copy",
  "original copy",
  "tax receipt",
  "thank you",
  "visit again",
  "cash sale",
  "cash memo",
  "retail invoice",
  "gst invoice",
  "bill details",
  "invoice details",
  "payment details",
  "receipt details",
];

const vendorBusinessTerms = [
  "hotel",
  "restaurant",
  "restro",
  "resto",
  "cafe",
  "bar",
  "bakery",
  "snacks",
  "juice",
  "mart",
  "store",
  "traders",
  "enterprises",
  "services",
  "travels",
  "resort",
  "residency",
  "caterers",
  "caterer",
  "foods",
  "food",
];

const vendorMeaningfulTerms = [
  ...vendorBusinessTerms,
  "enterprises",
  "enterprise",
  "services",
  "service",
  "solutions",
  "solution",
  "center",
  "centre",
  "medical",
  "pharmacy",
  "super",
  "market",
  "stationers",
  "stationery",
  "agency",
  "agencies",
  "trading",
  "traders",
  "electronics",
  "mobile",
  "mobiles",
  "fashion",
  "residency",
  "bakers",
  "bakeries",
  "kitchen",
  "dining",
];

const descriptionMeaningfulTerms = [
  "laptop",
  "screen",
  "replacement",
  "repair",
  "service",
  "servicing",
  "maintenance",
  "stationery",
  "notebook",
  "printing",
  "printout",
  "photocopy",
  "xerox",
  "marker",
  "pen",
  "pencil",
  "paper",
  "office",
  "supplies",
  "breakfast",
  "lunch",
  "dinner",
  "meal",
  "snack",
  "coffee",
  "tea",
  "travel",
  "taxi",
  "parking",
  "toll",
  "fuel",
  "petrol",
  "diesel",
  "hotel",
  "accommodation",
  "booking",
];

const cleanVendorValue = (value) =>
  normalizeLine(value)
    .replace(/^(?:[a-z]\s+){1,2}(?=[a-z]{3,})/i, "")
    .replace(/^(?:upi|bank|payment|paid\s*to|pay\s*to|paidto|payto|received\s*from|merchant|beneficiary|transfer\s*to|paying|to)\b[: -]*/i, "")
    .replace(/^(?:tax\s+invoice|retail\s+invoice|gst\s+invoice|cash\s+memo|invoice|receipt|bill)\b[: -]*/i, "")
    .replace(/\b(utr|txn|transaction|ref(?:erence)? no)\b.*$/i, "")
    .replace(/\b(?:gstin|gst no|gstin no|mob|mobile|phone|table|waiter|covers|bill no|date)\b.*$/i, "")
    .replace(/\b(?:t\s*-?\s*no|emp\.?\s*no|employee\s*no|qty|quantity|rate|particulars|invoice\s*#?)\b.*$/i, "")
    .replace(/\b(?:address|road|rd|street|st|lane|ln|building|complex|tower|plaza|society|suite|office|branch|near|opp(?:osite)?|pune|mumbai|bangalore|bengaluru|delhi|india)\b.*$/i, "")
    .replace(/\b(?:thank you|visit again|customer copy|merchant copy|duplicate copy|original copy)\b.*$/i, "")
    .replace(/\b([A-Za-z][A-Za-z&.'-]{2,}(?:\s+[A-Za-z][A-Za-z&.'-]{2,}){0,5})\s+\1\b/i, "$1")
    .replace(/[|]/g, " ")
    .replace(/[\\/_]+$/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[=:\-\s]+|[=:\-\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const stripVendorHeaderTerms = (value) => {
  let next = normalizeLine(value);
  vendorHeaderTerms.forEach((term) => {
    const pattern = new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, "ig");
    next = next.replace(pattern, " ");
  });
  return next.replace(/\s{2,}/g, " ").trim();
};

const looksLikeVendorName = (value) => {
  const cleaned = cleanVendorValue(value);
  const normalized = normalizeToken(cleaned);
  const tokens = normalized.split(" ").filter(Boolean);
  const letterCount = (cleaned.match(/[a-z]/gi) || []).length;
  const digitCount = (cleaned.match(/\d/g) || []).length;
  if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return false;
  if (/^(?:t\s*-?\s*no|emp\.?\s*no|employee\s*no|table|qty|quantity|rate|particulars)\b/i.test(cleaned)) {
    return false;
  }
  if (vendorRejectTerms.some((term) => normalized.includes(normalizeToken(term)))) {
    return false;
  }
  if (/\d{5,}/.test(cleaned)) return false;
  if (/[@]/.test(cleaned)) return false;
  if (/(www\.|\.com)/i.test(cleaned)) return false;
  if (/(utr|txn|transaction|ref(?:erence)?|date|time|balance|status|successful|completed|emp\.?\s*no|t\s*-?\s*no|table|qty|quantity|rate|particulars|amount|cashier|biller|token\s*no)/i.test(cleaned)) {
    return false;
  }
  if (/\b\d{1,2}:\d{2}\b/.test(cleaned)) return false;
  if (/(run by|runed by|branch of|near |opp\.?|opposite)/i.test(cleaned)) return false;
  if (tokens.some((token) => vendorAddressTerms.includes(token))) return false;
  if (/\b\d{1,4}[/-]\d{1,4}\b/.test(cleaned)) return false;
  if (tokens.length <= 2 && tokens.some((token) => token.length === 1)) return false;
  if (letterCount < 5 && !(tokens.length === 1 && cleaned.length >= 3)) return false;
  if (digitCount > 0 && letterCount <= digitCount + 2) return false;
  
  const validWords = tokens.filter(t => /[a-z]{3,}/i.test(t));
  if (validWords.length === 0) return false;
  if (validWords.length === 1 && ["receipt", "invoice", "customer", "payment", "transaction", "details"].includes(validWords[0])) {
    return false;
  }

  return letterCount >= 3 && tokens.length <= 8;
};

const normalizeVendorDisplay = (value) => {
  const cleaned = cleanVendorValue(value);
  if (!cleaned) return "";
  if (/^[A-Z](?:\s+[A-Z]){2,}$/i.test(cleaned)) {
    return titleCase(cleaned.replace(/\s+/g, ""));
  }
  if (/^[A-Z0-9 '&.,/-]+$/.test(cleaned)) {
    return titleCase(cleaned);
  }
  return cleaned;
};

const levenshteinDistance = (a, b) => {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
};

const looksLikeOcrConfusedToken = (token) =>
  /[01l5s8bg]/i.test(String(token || "")) || /(rn|vv|cl|ii|tt|ff)/i.test(String(token || ""));

const matchTokenCase = (sourceToken, targetToken) => {
  const source = String(sourceToken || "");
  const target = String(targetToken || "");
  if (!source) return target;
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return titleCase(target);
  return target.toLowerCase();
};

const buildMeaningfulVocabulary = (lines, baseTerms = []) => {
  const tokens = new Set(baseTerms.map((term) => normalizeToken(term)).filter(Boolean));
  lines.forEach((line, index) => {
    if (index > 4) return;
    String(line || "")
      .split(/\s+/)
      .map((part) => String(part || "").replace(/[^A-Za-z]/g, "").trim())
      .filter((part) => part.length >= 4 && /^[A-Za-z]+$/.test(part))
      .forEach((part) => tokens.add(part.toLowerCase()));
  });
  return [...tokens];
};

const correctTokenWithVocabulary = (token, vocabulary = []) => {
  const rawToken = String(token || "");
  const cleanedToken = rawToken.replace(/[^A-Za-z]/g, "");
  if (cleanedToken.length < 4 || !looksLikeOcrConfusedToken(cleanedToken)) {
    return rawToken;
  }

  const normalizedToken = cleanedToken.toLowerCase();
  let bestCandidate = "";
  let bestDistance = Infinity;

  vocabulary.forEach((candidate) => {
    const normalizedCandidate = normalizeToken(candidate);
    if (!normalizedCandidate || Math.abs(normalizedCandidate.length - normalizedToken.length) > 2) return;
    const distance = levenshteinDistance(normalizedToken, normalizedCandidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = normalizedCandidate;
    }
  });

  if (!bestCandidate) return rawToken;
  if (bestDistance > (normalizedToken.length >= 7 ? 2 : 1)) return rawToken;

  return rawToken.replace(cleanedToken, matchTokenCase(cleanedToken, bestCandidate));
};

const repairMeaningfulOcrText = (value, lines, vocabulary) =>
  String(value || "")
    .split(/\s+/)
    .map((token) => correctTokenWithVocabulary(token, vocabulary))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

const vendorMeaningScore = (value, lineIndex, documentStyle, source = "") => {
  const normalized = normalizeToken(value);
  const tokens = normalized.split(" ").filter(Boolean);
  let score = 0.0;

  if (tokens.some((token) => vendorBusinessTerms.includes(token))) score += 0.22;
  if (tokens.some((token) => vendorAddressTerms.includes(token))) score -= 0.45;
  if (source === "labeled") score += 0.22;
  if (source === "header_next_line") score += 0.14;
  if (lineIndex <= 1) score += 0.16;
  if (documentStyle === "receipt" && lineIndex > 3) score -= 0.04 * (lineIndex - 3);
  if (documentStyle === "payment_screenshot" && hasAnyTerm(value, PAYMENT_VENDOR_LABELS)) score += 0.12;
  if (/^(?:[a-z]+\s+){3,}[a-z]+$/i.test(value) && !tokens.some((token) => vendorBusinessTerms.includes(token))) score -= 0.12;

  return score;
};

const buildVendorCandidate = (rawValue, score, lineIndex, source) => {
  const value = normalizeVendorDisplay(rawValue);
  if (!looksLikeVendorName(value)) return null;
  return {
    value,
    score,
    lineIndex,
    source,
  };
};

const buildCombinedVendorCandidate = (firstLine, secondLine, score, lineIndex, source) => {
  const first = cleanVendorValue(firstLine);
  const second = cleanVendorValue(secondLine);
  if (!first || !second) return null;
  const normalizedSecond = normalizeToken(second);
  const secondTokens = normalizedSecond.split(" ").filter(Boolean);
  const secondLooksLikeAddress =
    secondTokens.some((token) => vendorAddressTerms.includes(token)) ||
    /\d/.test(second) ||
    second.includes(",") ||
    /\b(?:floor|building|road|street|lane|nagar|near|opp|opposite|branch|office|complex|tower|plaza|city|state)\b/i.test(second);
  const firstLooksLikeStrongVendor =
    hasAnyTerm(first, vendorBusinessTerms) ||
    /^[A-Z0-9 '&./-]{4,}$/.test(first) ||
    normalizeToken(first).split(" ").length <= 4;

  if (secondLooksLikeAddress || firstLooksLikeStrongVendor) {
    return null;
  }
  const combined = normalizeVendorDisplay(`${first} ${second}`);
  if (!looksLikeVendorName(combined)) return null;
  if (combined.length > 64) return null;
  return {
    value: combined,
    score,
    lineIndex,
    source,
  };
};

const scoreVendorCandidate = (candidate, documentStyle) => {
  if (!candidate?.value) return -Infinity;

  const normalized = normalizeToken(candidate.value);
  const tokens = normalized.split(" ").filter(Boolean);
  let score = Number(candidate.score || 0);

  if (tokens.some((token) => vendorBusinessTerms.includes(token))) score += 0.2;
  if (tokens.some((token) => vendorAddressTerms.includes(token))) score -= 0.35;
  if (vendorRejectTerms.some((term) => normalized.includes(normalizeToken(term)))) score -= 1.1;
  if (tokens.length === 1 && /^[A-Z][a-z]{2,20}$/.test(candidate.value) && candidate.lineIndex <= 3) score += 0.32;
  if (tokens.length >= 2 && tokens.length <= 4 && candidate.lineIndex <= 3) score += 0.14;
  if (/^[A-Z](?:\s+[A-Z]){2,}$/i.test(candidate.value)) score += 0.24;
  if (candidate.source === "top_lines_combined") score += 0.1;
  if (/(?:t\s*-?\s*no|emp\.?\s*no|employee\s*no|table|qty|quantity|rate|particulars|amount)/i.test(candidate.value)) score -= 0.9;
  if (/(run by|runed by|branch of|near |opp\.?|opposite)/i.test(candidate.value)) score -= 0.25;
  if (/^\(?[a-z ]+\)?$/i.test(candidate.value) && tokens.length > 2 && !tokens.some((token) => vendorBusinessTerms.includes(token))) {
    score -= 0.14;
  }
  score += vendorMeaningScore(candidate.value, candidate.lineIndex, documentStyle, candidate.source);
  if (candidate.source === "header_next_line") score += 0.12;
  if (candidate.source === "labeled") score += 0.16;
  if (candidate.source === "top_lines" && candidate.lineIndex > 1) score -= 0.05 * candidate.lineIndex;
  if (documentStyle === "receipt" && candidate.lineIndex > 3) score -= 0.04 * (candidate.lineIndex - 3);

  return score;
};

const extractVendorCandidate = (lines, documentStyle) => {
  const candidates = [];
  lines.forEach((line, index) => {
    const directMatch = line.match(
      /\b(?:merchant|vendor|seller|store|shop|billed by|paid to|pay to|received from|beneficiary|transfer to|paying)\s*[:.-]?\s*([A-Za-z][A-Za-z0-9 &'.,/-]{2,})/i
    );
    if (!directMatch) return;
    const candidate = buildVendorCandidate(
      directMatch[1],
      documentStyle === "payment_screenshot" ? 0.95 : 0.9,
      index,
      "labeled"
    );
    if (candidate) candidates.push(candidate);
  });

  const upperBound = Math.min(lines.length, documentStyle === "payment_screenshot" ? 14 : 10);
  for (let index = 0; index < upperBound; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const normalizedLine = normalizeLine(line);

    let score = 0.62;
    if (index <= 1) score += 0.2;
    if (/^[A-Z0-9 '&.,/-]+$/.test(normalizedLine)) score += 0.14;
    if (normalizedLine.split(" ").length <= 5) score += 0.08;
    if (documentStyle === "payment_screenshot" && hasAnyTerm(line, PAYMENT_VENDOR_LABELS)) {
      score += 0.16;
    }

    if (!noiseTokens.some((token) => lower.includes(token))) {
      const directCandidate = buildVendorCandidate(normalizedLine, score, index, "top_lines");
      if (directCandidate) candidates.push(directCandidate);

      const nextLine = lines[index + 1];
      if (nextLine && index <= 2) {
        const combinedCandidate = buildCombinedVendorCandidate(
          normalizedLine,
          nextLine,
          score + 0.12,
          index,
          "top_lines_combined"
        );
        if (combinedCandidate) candidates.push(combinedCandidate);
      }
    }

    if (vendorHeaderTerms.some((term) => lower.includes(term))) {
      const strippedInline = stripVendorHeaderTerms(normalizedLine);
      const inlineCandidate = buildVendorCandidate(strippedInline, score + 0.18, index, "header_inline");
      if (inlineCandidate) candidates.push(inlineCandidate);

      const nextLine = lines[index + 1];
      if (nextLine) {
        const afterHeaderCandidate = buildVendorCandidate(
          nextLine,
          score + 0.24,
          index + 1,
          "header_next_line"
        );
        if (afterHeaderCandidate) candidates.push(afterHeaderCandidate);
      }
    }
  }

  return candidates
    .sort(
      (a, b) =>
        scoreVendorCandidate(b, documentStyle) - scoreVendorCandidate(a, documentStyle) ||
        b.score - a.score ||
        a.lineIndex - b.lineIndex
    )[0] || null;
};

const repairVendorCandidateText = (candidate, lines = []) => {
  if (!candidate?.value) return candidate;
  const vocabulary = buildMeaningfulVocabulary(lines, vendorMeaningfulTerms);
  const repairedValue = normalizeVendorDisplay(repairMeaningfulOcrText(candidate.value, lines, vocabulary));
  if (!repairedValue || !looksLikeVendorName(repairedValue)) {
    return candidate;
  }
  return {
    ...candidate,
    value: repairedValue,
  };
};

const extractDescriptionCandidate = (lines, vendorValue, documentStyle) => {
  const descriptions = [];
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (!line || line === vendorValue) return;
    if (line.length < 4 || line.length > 80) return;
    if (/(gst|cgst|sgst|igst|tax|total|subtotal|amount|invoice|receipt|date|time|utr|txn id|reference|bank balance)/i.test(lower)) {
      return;
    }
    if (/^\d+([.,]\d+)?$/.test(line)) return;
    if (extractAmountsFromLine(line).length > 0) return;
    
    const letters = (line.match(/[a-z]/gi) || []).length;
    const nonSpaces = line.replace(/\s/g, '').length;
    if (nonSpaces === 0 || letters / nonSpaces < 0.5) return;
    if (!/[a-z]{3,}/i.test(lower)) return;

    let score = 0.45;
    if (/(for|towards|item|service|desc|description|payment for|note|purpose|remarks)/i.test(lower)) {
      score += 0.2;
    }
    if (index > 0 && index < 15) score += 0.08;
    if (documentStyle === "payment_screenshot" && /(paid to|received from|upi|merchant)/i.test(lower)) {
      score -= 0.12;
    }
    descriptions.push({ value: line, score, lineIndex: index });
  });

  return descriptions.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex)[0] || null;
};

const repairDescriptionCandidateText = (candidate, lines = []) => {
  if (!candidate?.value) return candidate;
  const vocabulary = buildMeaningfulVocabulary(lines, [
    ...descriptionMeaningfulTerms,
    ...vendorMeaningfulTerms,
  ]);
  const repairedValue = repairMeaningfulOcrText(candidate.value, lines, vocabulary);
  if (!repairedValue || repairedValue.length < 4) {
    return candidate;
  }
  return {
    ...candidate,
    value: repairedValue,
  };
};

const extractSupplementalDescription = (lines) => {
  const matched = lines.filter((line) =>
    /\b(?:description|item|service|purpose|for|narration|remarks|note)\b/i.test(line)
  );
  return matched.slice(0, 2).join(" | ");
};

const detectDominantCurrency = (candidates, lines = [], documentStyle = "receipt") => {
  return "INR";
};

const clampConfidence = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const buildPaymentAmountRectangles = (dimensions) => {
  const width = Number(dimensions?.width || 0);
  const height = Number(dimensions?.height || 0);
  if (!width || !height) return [];

  const rectangleFromPercent = (label, leftPct, topPct, widthPct, heightPct, psm = 7, whitelist = "") => ({
    label,
    rectangle: {
      left: Math.max(0, Math.round(width * leftPct)),
      top: Math.max(0, Math.round(height * topPct)),
      width: Math.max(1, Math.round(width * widthPct)),
      height: Math.max(1, Math.round(height * heightPct)),
    },
    psm,
    whitelist,
  });

  return [
    rectangleFromPercent("payment_amount_primary", 0.18, 0.12, 0.64, 0.20, 6, "₹RsINR0123456789.,"),
    rectangleFromPercent("payment_amount_tight", 0.24, 0.17, 0.52, 0.12, 7, "₹RsINR0123456789.,"),
    rectangleFromPercent("payment_amount_wide", 0.12, 0.10, 0.76, 0.24, 11, "₹RsINR0123456789.,ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
  ];
};

const extractPaymentAmountCandidateFromText = (text) => {
  const lines = dedupeLines(String(text || "").split(/\r?\n/));
  const candidates = [];

  lines.forEach((line, index) => {
    const lower = String(line || "").toLowerCase();
    if (!line || isSuspiciousAmountLine(line)) return;
    const amounts = extractAmountsFromLine(line, "payment_screenshot");
    if (amounts.length === 0) return;

    amounts.forEach(({ amount, raw, artifactAdjusted }) => {
      if (!Number.isFinite(amount) || amount <= 0 || amount > OCR_MAX_REASONABLE_TOTAL) return;

      let score = 0.72;
      if (hasCurrencyCue(raw || line, "payment_screenshot")) score += 0.18;
      if (/^[^\d]{0,4}(?:rs\.?|inr|₹)?\s*\d(?:[\d,\s]*\d)?(?:\.\s*\d{0,2})?[^\d]{0,2}$/i.test(line.trim())) score += 0.16;
      if (/^\d(?:[\d,\s]*\d)?(?:\.\s*\d{0,2})?$/.test(line.trim())) score += 0.09;
      if (/(paid|payment|debited|completed|to)/i.test(lower)) score += 0.05;
      if (amount < 10) score -= 0.4;
      if (/\b(?:19|20)\d{2}\b/.test(line)) score -= 0.18;
      if (/[a-z]{4,}\d+[a-z0-9]{2,}/i.test(line)) score -= 0.32;
      if (artifactAdjusted) score += 0.03;

      candidates.push({
        amount,
        line,
        raw,
        lineIndex: index,
        score,
        explicitCurrency: hasCurrencyCue(raw || line, "payment_screenshot"),
        artifactAdjusted: Boolean(artifactAdjusted),
      });
    });
  });

  if (candidates.length === 0) return null;

  const grouped = new Map();
  candidates.forEach((candidate) => {
    const key = Number(candidate.amount).toFixed(2);
    const existing = grouped.get(key);
    const candidateScore = Number(candidate.score || 0);

    if (!existing) {
      grouped.set(key, {
        ...candidate,
        hits: 1,
        explicitCurrencyHits: candidate.explicitCurrency ? 1 : 0,
        artifactAdjustedHits: candidate.artifactAdjusted ? 1 : 0,
      });
      return;
    }

    existing.hits += 1;
    existing.explicitCurrencyHits += candidate.explicitCurrency ? 1 : 0;
    existing.artifactAdjustedHits += candidate.artifactAdjusted ? 1 : 0;
    existing.score = Math.max(Number(existing.score || 0), candidateScore);

    if (
      candidate.explicitCurrency && !existing.explicitCurrency ||
      candidateScore >= Number(existing.score || 0)
    ) {
      existing.line = candidate.line;
      existing.raw = candidate.raw;
      existing.lineIndex = candidate.lineIndex;
      existing.explicitCurrency = candidate.explicitCurrency;
      existing.artifactAdjusted = candidate.artifactAdjusted;
    }
  });

  return [...grouped.values()].sort((a, b) =>
    b.hits - a.hits ||
    b.explicitCurrencyHits - a.explicitCurrencyHits ||
    b.score - a.score ||
    a.artifactAdjustedHits - b.artifactAdjustedHits ||
    b.amount - a.amount ||
    a.lineIndex - b.lineIndex
  )[0] || null;
};

const computeConfidenceMetrics = (fieldConfidence, engineResults, metadata = {}) => {
  const engineScores = engineResults
    .filter((item) => item.available && Number.isFinite(Number(item.confidence)) && Number(item.confidence) > 0)
    .map((item) => Number(item.confidence));
  const fieldScores = Object.values(fieldConfidence)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const weakestField = fieldScores.length > 0 ? Math.min(...fieldScores) : 0;
  const fieldAverage = fieldScores.length > 0
    ? fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length
    : 0;
  const engineAverage = engineScores.length > 0
    ? engineScores.reduce((sum, value) => sum + value, 0) / engineScores.length
    : 0;
  const engineSpread = engineScores.length > 1 ? Math.max(...engineScores) - Math.min(...engineScores) : 0;

  const criticalFieldScores = ["vendorName", "expenseDate", "totalAmount"]
    .map((key) => Number(fieldConfidence[key] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const criticalAverage = criticalFieldScores.length > 0
    ? criticalFieldScores.reduce((sum, value) => sum + value, 0) / criticalFieldScores.length
    : 0;
  const criticalWeakest = criticalFieldScores.length > 0 ? Math.min(...criticalFieldScores) : 0;

  let overall =
    (fieldAverage * 0.28) +
    (criticalAverage * 0.34) +
    (criticalWeakest * 0.18) +
    (engineAverage * 0.20);

  if (engineSpread > 22) overall -= 6;
  if ((metadata.missingCriticalFields || 0) > 0) overall -= metadata.missingCriticalFields * 10;
  if (criticalWeakest > 0 && criticalWeakest < 55) overall -= 6;
  if (Number(fieldConfidence.totalAmount || 0) > 0 && Number(fieldConfidence.totalAmount || 0) < 70) overall -= 4;
  if (Number(fieldConfidence.vendorName || 0) > 0 && Number(fieldConfidence.vendorName || 0) < 58) overall -= 3;
  if (Number(fieldConfidence.expenseDate || 0) > 0 && Number(fieldConfidence.expenseDate || 0) < 52) overall -= 2;
  if (metadata.documentStyle === "payment_screenshot" && (!fieldConfidence.vendorName || !fieldConfidence.totalAmount)) {
    overall -= 10;
  }
  if (metadata.currencyCode && metadata.currencyCode !== "INR") {
    overall -= 3;
  }
  if (criticalFieldScores.length === 3 && criticalWeakest >= 85) {
    overall += 4;
  }

  return {
    engineAverage: clampConfidence(engineAverage),
    fieldAverage: clampConfidence(fieldAverage),
    overallConfidence: clampConfidence(overall),
  };
};

const runFocusedTesseractPass = async (imagePath, config) => {
  if (!createWorker) {
    return {
      engine: `tesseract_focus_${config.label}`,
      available: false,
      text: "",
      confidence: 0,
      error: "create_worker_unavailable",
    };
  }

  let worker;
  try {
    const workerOptions = {
      gzip: false,
    };
    if (hasLocalTesseractLanguage) {
      workerOptions.langPath = TESSERACT_LANG_PATH;
    }

    worker = await createWorker("eng", 1, workerOptions);
    await worker.setParameters({
      tessedit_pageseg_mode: String(config.psm || 7),
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      ...(config.whitelist ? { tessedit_char_whitelist: config.whitelist } : {}),
    });

    const result = await withTimeout(
      worker.recognize(imagePath, {
        rectangle: config.rectangle,
      }),
      OCR_TESSERACT_TIMEOUT_MS,
      `focused tesseract ${config.label}`
    );

    return {
      engine: `tesseract_focus_${config.label}`,
      available: true,
      text: String(result?.data?.text || ""),
      confidence: Number(result?.data?.confidence || 0),
      rectangle: config.rectangle,
    };
  } catch (error) {
    return {
      engine: `tesseract_focus_${config.label}`,
      available: false,
      text: "",
      confidence: 0,
      error: error.message,
      rectangle: config.rectangle,
    };
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
};

const runFocusedPaymentAmountPasses = async (imagePath) => {
  const dimensions = getImageDimensions(imagePath);
  const configs = buildPaymentAmountRectangles(dimensions);
  if (configs.length === 0) return [];

  const results = [];
  for (const config of configs) {
    // Run sequentially to keep memory usage predictable.
    // This path is only used as a targeted fallback for payment screenshots.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runFocusedTesseractPass(imagePath, config));
  }
  return results;
};

const buildReviewNotes = (fields, overallConfidence, engineResults, metadata = {}, fieldConfidence = {}) => {
  const notes = [];
  const vendorConfidence = Number(fieldConfidence.vendorName || 0);
  const dateConfidence = Number(fieldConfidence.expenseDate || 0);
  const totalConfidence = Number(fieldConfidence.totalAmount || 0);

  if (!fields.totalAmount) {
    notes.push("Total amount could not be extracted confidently.");
  } else if (totalConfidence > 0 && totalConfidence < 72) {
    notes.push("Total amount was detected, but the confidence is moderate. Please verify it before saving.");
  }

  if (!fields.expenseDate) {
    notes.push("Receipt date is missing or unclear.");
  } else if (dateConfidence > 0 && dateConfidence < 60) {
    notes.push("Receipt date was found with low confidence. Please confirm the date.");
  }

  if (!fields.vendorName) {
    notes.push("Vendor name looks uncertain.");
  } else if (vendorConfidence > 0 && vendorConfidence < 62) {
    notes.push("Vendor name may be incomplete or noisy. Please verify the merchant name.");
  }

  if (metadata.documentStyle === "payment_screenshot" && !fields.vendorName) {
    notes.push("Payment screenshot detected, but merchant or beneficiary name is still uncertain.");
  }
  if (metadata.documentStyle === "payment_screenshot" && !fields.totalAmount) {
    notes.push("Payment screenshot detected, but the main paid amount was not read by OCR. Please verify the amount manually.");
  }
  if (metadata.currencyCode && metadata.currencyCode !== "INR") {
    notes.push(`Detected ${metadata.currencyCode} currency. Please verify the amount before saving the expense.`);
  }
  if (overallConfidence < 70) notes.push("Overall OCR confidence is low. Please analyze and verify manually.");
  if (engineResults.every((item) => !item.available)) notes.push("No OCR engine was available.");
  return notes;
};

const mapMlFieldName = (fieldName) => {
  const normalized = String(fieldName || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["vendor", "vendorname", "merchant", "merchantname", "seller", "storename", "payee", "beneficiary"].includes(normalized)) {
    return "vendorName";
  }
  if (["date", "receiptdate", "transactiondate", "invoicedate", "billdate", "expensedate"].includes(normalized)) {
    return "expenseDate";
  }
  if (["total", "amount", "totalamount", "grandtotal", "paidamount", "nettotal", "billtotal"].includes(normalized)) {
    return "totalAmount";
  }
  if (["description", "details", "purpose", "narration", "remarks", "itemsummary"].includes(normalized)) {
    return "description";
  }
  if (["category", "expensecategory"].includes(normalized)) {
    return "predictedCategory";
  }
  return "";
};

const isReasonableExpenseTotal = (amount) =>
  Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= OCR_MAX_REASONABLE_TOTAL;

const shouldAcceptMlTotal = ({ parsed, amount, scorePercent }) => {
  if (!isReasonableExpenseTotal(amount)) {
    return false;
  }

  if (scorePercent < 60) {
    return false;
  }

  const existingTotal = Number(parsed?.fields?.totalAmount);
  const existingConfidence = Number(parsed?.fieldConfidence?.totalAmount || 0);
  if (Number.isFinite(existingTotal) && existingTotal > 0) {
    const ratio = amount / existingTotal;
    if ((ratio > 5 || ratio < 0.2) && existingConfidence > 75) {
      return false;
    }
  }

  return true;
};

const shouldAcceptMlTextField = ({ currentValue, currentConfidence, nextValue, nextConfidence, minScore = 55 }) => {
  const normalizedNext = String(nextValue || "").trim();
  if (!normalizedNext || nextConfidence < minScore) {
    return false;
  }

  const normalizedCurrent = String(currentValue || "").trim();
  if (!normalizedCurrent) {
    return true;
  }

  if (nextConfidence >= currentConfidence + 10) {
    return true;
  }

  return normalizedNext.length >= normalizedCurrent.length + 4 && nextConfidence >= currentConfidence;
};

const shouldRunMlExtraction = (parsed) => {
  const fields = parsed?.fields || {};
  const fieldConfidence = parsed?.fieldConfidence || {};
  const vendorValue = String(fields.vendorName || "").trim();
  const vendorLooksSuspicious =
    !vendorValue ||
    /^(?:to|paidto|payto)\b/i.test(vendorValue) ||
    !looksLikeVendorName(vendorValue) ||
    normalizeVendorDisplay(vendorValue) !== vendorValue;
  const dateLooksSuspicious = Boolean(fields.expenseDate) && !parseDateValue(fields.expenseDate);

  const hasHighConfidenceEssentials =
    fields.vendorName && Number(fieldConfidence.vendorName) >= 80 &&
    fields.totalAmount && Number(fieldConfidence.totalAmount) >= 80;

  if (hasHighConfidenceEssentials && !vendorLooksSuspicious && !dateLooksSuspicious) {
    return false; // Skip ML if core fields are extremely confident
  }

  if (!fields.suggestedExpenseCategory && !fields.predictedCategory) {
    return true;
  }

  const missingCriticalFields = ["vendorName", "expenseDate", "totalAmount"].filter(
    (fieldName) => !fields[fieldName]
  ).length;

  if (missingCriticalFields > 0) {
    return true;
  }

  const lowConfidenceCriticalField = ["vendorName", "expenseDate", "totalAmount"].some(
    (fieldName) => Number(fieldConfidence[fieldName] || 0) < 68
  );
  if (lowConfidenceCriticalField) {
    return true;
  }

  return Number(parsed?.overallConfidence || 0) < 62;
};

const mergeMlExtraction = (parsed, mlOutput, warnings) => {
  if (!mlOutput || !mlOutput.fields) {
    return parsed;
  }

  const next = {
    ...parsed,
    fields: { ...(parsed.fields || {}) },
    fieldConfidence: { ...(parsed.fieldConfidence || {}) },
    reviewNotes: [...(parsed.reviewNotes || [])],
    warnings: [...(warnings || [])],
    availableEngines: [...(parsed.availableEngines || [])],
    metadata: { ...(parsed.metadata || {}) },
  };

  for (const [mlFieldName, payload] of Object.entries(mlOutput.fields || {})) {
    const fieldName = mapMlFieldName(mlFieldName);
    if (!fieldName) continue;
    const scorePercent = clampConfidence(Number(payload.score || 0) * 100);
    const textValue = String(payload.text || "").trim();
    if (!textValue) continue;

    if (fieldName === "totalAmount") {
      const amount = parseAmountValue(textValue);
      if (shouldAcceptMlTotal({ parsed: next, amount, scorePercent })) {
        next.fields.totalAmount = Number(amount.toFixed(2));
        next.fields.amount = Number(amount.toFixed(2));
        next.metadata.currencyCode =
          detectCurrencyFromText(textValue) || next.metadata.currencyCode || "INR";
      }
    } else if (fieldName === "expenseDate") {
      const parsedDate = parseDateValue(textValue);
      const existingDate = String(next.fields.expenseDate || "").trim();
      const existingConfidence = Number(next.fieldConfidence.expenseDate || 0);
      const existingParsedDate = parseDateValue(existingDate);
      if (
        parsedDate &&
        shouldAcceptMlTextField({
          currentValue: existingDate,
          currentConfidence: existingConfidence,
          nextValue: parsedDate,
          nextConfidence: scorePercent,
          minScore: 58,
        })
      ) {
        next.fields.expenseDate = parsedDate;
      } else if (!existingParsedDate && parsedDate && scorePercent >= Math.max(52, existingConfidence)) {
        next.fields.expenseDate = parsedDate;
      }
    } else if (fieldName === "vendorName") {
      const normalizedVendor = normalizeVendorDisplay(textValue);
      if (looksLikeVendorName(normalizedVendor)) {
        const existingVendor = String(next.fields.vendorName || "").trim();
        const existingConfidence = Number(next.fieldConfidence.vendorName || 0);
        const existingVendorSuspicious =
          !existingVendor ||
          /^(?:to|paidto|payto)\b/i.test(existingVendor) ||
          !looksLikeVendorName(existingVendor) ||
          normalizeVendorDisplay(existingVendor) !== existingVendor;
        const looksStrongerThanExisting =
          existingVendorSuspicious ||
          scorePercent >= existingConfidence + 12 ||
          (hasAnyTerm(normalizedVendor, vendorBusinessTerms) && !hasAnyTerm(existingVendor, vendorBusinessTerms)) ||
          shouldAcceptMlTextField({
            currentValue: existingVendor,
            currentConfidence: existingConfidence,
            nextValue: normalizedVendor,
            nextConfidence: scorePercent,
            minScore: 60,
          });

        if (looksStrongerThanExisting) {
          next.fields.vendorName = normalizedVendor;
        }
      }
    } else if (fieldName === "predictedCategory") {
      const normalizedCategory = titleCase(textValue);
      if (scorePercent >= 38) {
        next.fields.predictedCategory = normalizedCategory;
        const suggestedExpenseCategory = mapPredictedCategoryToExpenseCategory(normalizedCategory);
        if (suggestedExpenseCategory && AUTO_ASSIGNABLE_EXPENSE_CATEGORIES.has(suggestedExpenseCategory)) {
          next.fields.suggestedExpenseCategory = suggestedExpenseCategory;
          next.fields.customCategoryLabel = "";
          next.fields.customCategoryConfidence = 0;
        } else {
          next.fields.suggestedExpenseCategory = "other";
          next.fields.customCategoryLabel = normalizedCategory;
          next.fields.customCategoryConfidence = scorePercent;
        }
      }
    } else {
      const existingValue = String(next.fields[fieldName] || "").trim();
      const existingConfidence = Number(next.fieldConfidence[fieldName] || 0);
      if (
        shouldAcceptMlTextField({
          currentValue: existingValue,
          currentConfidence: existingConfidence,
          nextValue: textValue,
          nextConfidence: scorePercent,
          minScore: 56,
        })
      ) {
        next.fields[fieldName] = textValue;
      }
    }

    next.fieldConfidence[fieldName] = Math.max(next.fieldConfidence[fieldName] || 0, scorePercent);
  }

  if (mlOutput.document_style) {
    next.metadata.documentStyle = mlOutput.document_style;
  }

  const predictedCategory =
    String(
      mlOutput.predicted_category ||
      next.fields.predictedCategory ||
      ""
    ).trim();
  if (
    predictedCategory &&
    (!mlOutput?.fields?.Category || Number(mlOutput?.fields?.Category?.score || 0) * 100 >= 38)
  ) {
    next.fields.predictedCategory = titleCase(predictedCategory);
    const suggestedExpenseCategory = mapPredictedCategoryToExpenseCategory(predictedCategory);
    if (suggestedExpenseCategory) {
      next.fields.suggestedExpenseCategory = suggestedExpenseCategory;
      next.metadata.suggestedExpenseCategory = suggestedExpenseCategory;
      if (AUTO_ASSIGNABLE_EXPENSE_CATEGORIES.has(suggestedExpenseCategory)) {
        next.fields.customCategoryLabel = "";
        next.fields.customCategoryConfidence = 0;
      } else {
        next.fields.customCategoryLabel = next.fields.predictedCategory;
        next.fields.customCategoryConfidence = Number(next.fieldConfidence.predictedCategory || 0);
      }
    }
    next.metadata.predictedCategory = next.fields.predictedCategory;
  }

  if (!next.availableEngines.includes("expense_ml")) {
    next.availableEngines.push("expense_ml");
  }

  const confidenceMetrics = computeConfidenceMetrics(
    next.fieldConfidence,
    [...(parsed.engines || []), { engine: "expense_ml", available: true, confidence: Number(next.overallConfidence || 0), text: "" }],
    {
      documentStyle: next.metadata.documentStyle,
      currencyCode: next.metadata.currencyCode,
      missingCriticalFields: ["vendorName", "expenseDate", "totalAmount"].filter(
        (fieldName) => !next.fields?.[fieldName]
      ).length,
    }
  );

  next.overallConfidence = confidenceMetrics.overallConfidence;
  next.metadata.engineAverageConfidence = confidenceMetrics.engineAverage;
  next.metadata.fieldAverageConfidence = confidenceMetrics.fieldAverage;
  next.reviewNotes = buildReviewNotes(
    next.fields,
    next.overallConfidence,
    [...(parsed.engines || []), { engine: "expense_ml", available: true, confidence: next.overallConfidence, text: "" }],
    next.metadata,
    next.fieldConfidence
  );

  return next;
};

const mergeFocusedPaymentAmount = (parsed, focusedCandidate) => {
  if (!focusedCandidate || !Number.isFinite(Number(focusedCandidate.amount)) || Number(focusedCandidate.amount) <= 0) {
    return parsed;
  }

  const currentAmount = Number(parsed?.fields?.totalAmount || 0);
  const focusedAmount = Number(focusedCandidate.amount);
  const focusedConfidence = clampConfidence(Number(focusedCandidate.score || 0) * 100);

  const shouldOverride =
    !Number.isFinite(currentAmount) ||
    currentAmount <= 0 ||
    Number(parsed?.fieldConfidence?.totalAmount || 0) < focusedConfidence;

  if (!shouldOverride) {
    return parsed;
  }

  const next = {
    ...parsed,
    fields: { ...(parsed.fields || {}) },
    fieldConfidence: { ...(parsed.fieldConfidence || {}) },
    warnings: [...(parsed.warnings || [])],
    metadata: { ...(parsed.metadata || {}) },
  };

  next.fields.totalAmount = Number(focusedAmount.toFixed(2));
  next.fields.amount = Number(focusedAmount.toFixed(2));
  next.fieldConfidence.totalAmount = focusedConfidence;
  next.metadata.currencyCode = next.metadata.currencyCode || "INR";
  next.fields.currencyCode = next.fields.currencyCode || next.metadata.currencyCode;
  next.warnings.push("Focused payment amount OCR was used to recover the paid amount.");

  const confidenceMetrics = computeConfidenceMetrics(
    next.fieldConfidence,
    next.engines || [],
    {
      documentStyle: next.metadata.documentStyle,
      currencyCode: next.metadata.currencyCode,
      missingCriticalFields: ["vendorName", "expenseDate", "totalAmount"].filter(
        (fieldName) => !next.fields?.[fieldName]
      ).length,
    }
  );

  next.overallConfidence = confidenceMetrics.overallConfidence;
  next.metadata.engineAverageConfidence = confidenceMetrics.engineAverage;
  next.metadata.fieldAverageConfidence = confidenceMetrics.fieldAverage;
  next.reviewNotes = buildReviewNotes(next.fields, next.overallConfidence, next.engines || [], next.metadata, next.fieldConfidence);

  return next;
};

const parseReceiptData = ({ engineResults, lines }) => {
  const documentStyle = detectDocumentStyle(lines);
  const amountCandidates = buildAmountCandidates(lines, documentStyle);
  let totalCandidate = chooseBestTotalCandidate(amountCandidates, documentStyle);

  const subtotalCandidate = chooseBestCandidate(amountCandidates, "subtotal");
  const gstCandidate = chooseBestCandidate(amountCandidates, "gst");

  if (documentStyle !== "payment_screenshot" && (!totalCandidate || !Number.isFinite(totalCandidate.amount))) {
    totalCandidate = chooseReceiptTrailingTotalFallback(amountCandidates, subtotalCandidate) || totalCandidate;
    
    if (!totalCandidate) {
      const validAmounts = amountCandidates.filter(c => 
        Number.isFinite(c.amount) && 
        c.amount > 0 && 
        !isSuspiciousAmountLine(c.line) &&
        c.label !== "gst"
      );
      if (validAmounts.length > 0) {
        totalCandidate = validAmounts.sort((a, b) => 
          Number(b.explicitCurrencyAmount || false) - Number(a.explicitCurrencyAmount || false) || 
          b.amount - a.amount
        )[0];
      }
    }
  }

  const recoveredTotalCandidate = recoverTruncatedTotalCandidate(
    amountCandidates,
    totalCandidate,
    subtotalCandidate,
    documentStyle
  );
  if (recoveredTotalCandidate) {
    totalCandidate = recoveredTotalCandidate;
  }

  let totalAmount = totalCandidate?.amount || null;
  let derivedTotalConfidenceScore = totalCandidate?.score || 0;
  if (!Number.isFinite(totalAmount) && subtotalCandidate && gstCandidate) {
    const combinedTotal = Number(subtotalCandidate.amount) + Number(gstCandidate.amount);
    if (
      isReasonableExpenseTotal(combinedTotal) &&
      Number(gstCandidate.amount) > 0 &&
      combinedTotal >= Number(subtotalCandidate.amount)
    ) {
      totalAmount = combinedTotal;
      derivedTotalConfidenceScore = Math.min(
        0.9,
        ((Number(subtotalCandidate.score || 0) + Number(gstCandidate.score || 0)) / 2) + 0.08
      );
    }
  }

  const vendorCandidate = repairVendorCandidateText(extractVendorCandidate(lines, documentStyle), lines);
  const dateCandidate = extractDateCandidate(lines);
  const descriptionCandidate = repairDescriptionCandidateText(
    extractDescriptionCandidate(lines, vendorCandidate?.value, documentStyle),
    lines
  );
  const supplementalDescription = extractSupplementalDescription(lines);
  const currencyCode = normalizeDetectedCurrencyCode(
    totalCandidate?.currency || detectDominantCurrency(amountCandidates, lines, documentStyle),
    lines
  );

  const gstAmount = 0;
  const baseAmount = Number.isFinite(totalAmount)
    ? Number(totalAmount.toFixed(2))
    : subtotalCandidate?.amount || null;

  const fieldConfidence = {
    vendorName: clampConfidence((vendorCandidate?.score || 0) * 100),
    expenseDate: clampConfidence((dateCandidate?.score || 0) * 100),
    totalAmount: clampConfidence(derivedTotalConfidenceScore * 100),
    gstAmount: 0,
    description: clampConfidence(Math.max(descriptionCandidate?.score || 0, supplementalDescription ? 0.54 : 0) * 100),
  };

  const confidenceMetrics = computeConfidenceMetrics(fieldConfidence, engineResults, {
    documentStyle,
    currencyCode,
    missingCriticalFields: ["vendorName", "expenseDate", "totalAmount"].filter(
      (fieldName) => !fieldConfidence[fieldName]
    ).length,
  });

  const fields = {
    vendorName: vendorCandidate?.value || "",
    expenseDate: dateCandidate?.value || "",
    totalAmount: Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : null,
    gstAmount,
    amount: Number.isFinite(baseAmount) ? Number(baseAmount.toFixed(2)) : null,
    description: descriptionCandidate?.value || supplementalDescription || "",
    currencyCode,
  };

  if (recoveredTotalCandidate && totalCandidate) {
    fieldConfidence.totalAmount = clampConfidence(Math.max(derivedTotalConfidenceScore * 100, 84));
  }

  const categoryPrediction = predictCategoryFromReceiptContent({ lines, fields });
  if (categoryPrediction) {
    fields.predictedCategory = categoryPrediction.predictedCategory;
    fields.suggestedExpenseCategory = categoryPrediction.suggestedExpenseCategory;
    fieldConfidence.predictedCategory = categoryPrediction.confidence;
    fields.customCategoryLabel = categoryPrediction.customCategoryLabel || "";
    fields.customCategoryConfidence = categoryPrediction.customCategoryConfidence || 0;
  } else {
    fields.suggestedExpenseCategory = "other";
    fields.customCategoryLabel = "";
    fields.customCategoryConfidence = 0;
  }

  const metadata = {
    documentStyle,
    currencyCode,
    engineAverageConfidence: confidenceMetrics.engineAverage,
    fieldAverageConfidence: confidenceMetrics.fieldAverage,
  };
  if (categoryPrediction) {
    metadata.predictedCategory = categoryPrediction.predictedCategory;
    metadata.suggestedExpenseCategory = categoryPrediction.suggestedExpenseCategory;
    metadata.customCategoryLabel = categoryPrediction.customCategoryLabel || "";
    metadata.customCategoryConfidence = categoryPrediction.customCategoryConfidence || 0;
  }

  const reviewNotes = buildReviewNotes(fields, confidenceMetrics.overallConfidence, engineResults, metadata, fieldConfidence);

  return {
    fields,
    fieldConfidence,
    overallConfidence: confidenceMetrics.overallConfidence,
    needsReview: reviewNotes.length > 0,
    reviewNotes,
    metadata,
  };
};

const runTesseractPass = async (imagePath, label, psm = 6) => {
  try {
    const options = {
      gzip: false,
      tessedit_pageseg_mode: String(psm),
    };

    if (hasLocalTesseractLanguage) {
      options.langPath = TESSERACT_LANG_PATH;
    }

    const result = await withTimeout(
      Tesseract.recognize(imagePath, "eng", options),
      OCR_TESSERACT_TIMEOUT_MS,
      `tesseract ${label}`
    );

    return {
      engine: `tesseract_js_${label}_psm${psm}`,
      available: true,
      text: String(result?.data?.text || ""),
      confidence: Number(result?.data?.confidence || 0),
    };
  } catch (error) {
    return {
      engine: `tesseract_js_${label}_psm${psm}`,
      available: false,
      text: "",
      confidence: 0,
      error: error.message,
    };
  }
};

const runDirectFallbackPasses = async (imagePath) => {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return [];
  }

  // Drastically reduce Tesseract.js processing time by using a single optimized PSM 4 
  // instead of 3 concurrent heavy passes.
  // Drastically reduce Tesseract.js processing time by using fewer passes
  return Promise.all([
    { label: "direct", psm: 6 },
    { label: "direct_block", psm: 4 },
    { label: "direct_sparse", psm: 11 },
  ].map((config) => runTesseractPass(imagePath, config.label, config.psm)));
};

const extractReceiptData = async ({
  imagePath,
  cropRect = null,
  rotation = 0,
  brightness = 100,
  contrast = 100,
  disablePython = false,
  disableMl = false,
}) => {
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error("Receipt file could not be found for OCR");
  }

  const normalizedCropRect = normalizeCropRectInput(cropRect);
  const normalizedRotation = Number(rotation) || 0;
  const normalizedBrightness = Number(brightness) || 100;
  const normalizedContrast = Number(contrast) || 100;
  const hasManualAdjustments =
    Boolean(normalizedCropRect) ||
    normalizedRotation !== 0 ||
    normalizedBrightness !== 100 ||
    normalizedContrast !== 100;

  const skipPython = Boolean(disablePython || DISABLE_PYTHON_OCR);
  const skipMl = Boolean(disableMl || DISABLE_ML_OCR);

  const warnings = [];
  let pythonOutput = null;

  if (!isPdfFile(imagePath) && !hasManualAdjustments) {
    // FAST TRACK: Try OCR on the original image first
    const directTesseractResults = await runDirectFallbackPasses(imagePath);
    let directEngineResults = [...directTesseractResults];
    let directLines = dedupeLines(
      directTesseractResults
        .filter((item) => item.available)
        .flatMap((item) => String(item.text || "").split(/\r?\n/))
    );
    let directParsed = parseReceiptData({ engineResults: directEngineResults, lines: directLines });

    if (
      directParsed.metadata?.documentStyle === "payment_screenshot" &&
      (!directParsed.fields?.totalAmount || Number(directParsed.fieldConfidence?.totalAmount || 0) < 90)
    ) {
      const focusedPaymentResults = await runFocusedPaymentAmountPasses(imagePath);
      const focusedCandidate = extractPaymentAmountCandidateFromText(
        focusedPaymentResults
          .filter((item) => item.available)
          .map((item) => item.text)
          .join("\n")
      );

      if (focusedPaymentResults.length > 0) {
        directEngineResults = [...directEngineResults, ...focusedPaymentResults];
        directLines = dedupeLines(
          directEngineResults
            .filter((item) => item.available)
            .flatMap((item) => String(item.text || "").split(/\r?\n/))
        );
        directParsed = parseReceiptData({ engineResults: directEngineResults, lines: directLines });
      }

      directParsed.engines = directEngineResults;
      directParsed = mergeFocusedPaymentAmount(directParsed, focusedCandidate);
    }

    // If the original image yields extremely high confidence, skip the slow Python processor completely.
    // For payment screenshots, require totalAmount confidence >= 90 (which means it found an explicit currency symbol),
    // otherwise it might be falsely matching the year or a phone number due to light fonts hiding the real amount.
    let canSkipPython = !shouldRunMlExtraction(directParsed);
    const isPaymentScreenshot = directParsed.metadata?.documentStyle === "payment_screenshot";
    const directTotalConfidence = Number(directParsed.fieldConfidence?.totalAmount || 0);

    if (canSkipPython && isPaymentScreenshot && directTotalConfidence < 90) {
      canSkipPython = false;
    }

    if (canSkipPython) {
      directParsed.availableEngines = directEngineResults.filter((item) => item.available).map((item) => item.engine);
      directParsed.engines = directEngineResults;
      return {
        ...directParsed,
        rawText: directLines.join("\n"),
        engines: directParsed.engines,
        warnings,
        availableEngines: directParsed.availableEngines,
      };
    }
  }

  if (isPdfFile(imagePath)) {
    warnings.push("PDF OCR is not supported in the current server setup. Upload an image receipt instead.");
  } else if (skipPython) {
    warnings.push("Python OCR preprocessing is disabled on this server.");
    if (hasManualAdjustments) {
      warnings.push("Image adjustments were requested, but preprocessing is disabled, so OCR used the original image.");
    }
  } else {
    try {
      pythonOutput = await runPythonProcessor(imagePath, {
        cropRect: normalizedCropRect,
        rotation: normalizedRotation,
        brightness: normalizedBrightness,
        contrast: normalizedContrast,
      });
    } catch (error) {
      console.warn(`Expense OCR Python preprocessing unavailable: ${error.message}`);
    }
  }

  try {
    const variants = Array.isArray(pythonOutput?.variants) ? pythonOutput.variants : [];
    const variantPaths = variants
      .map((item) => ({
        label: item.label,
        path: item.path,
      }))
      .filter((item) => item.path && fs.existsSync(item.path))
      .slice(0, 3);

    let tesseractResults = [];
    if (variantPaths.length > 0) {
      tesseractResults = await Promise.all(
        variantPaths.map((variant) =>
          runTesseractPass(
            variant.path,
            variant.label,
            variant.label === "threshold" ? 4 : 6
          )
        )
      );
    } else if (!isPdfFile(imagePath)) {
      tesseractResults = await runDirectFallbackPasses(imagePath);
    }

    const pythonEngineResults = Array.isArray(pythonOutput?.ocrResults) ? pythonOutput.ocrResults : [];
    const engineResults = [...tesseractResults, ...pythonEngineResults];
    const lines = dedupeLines(
      engineResults
        .filter((item) => item.available)
        .flatMap((item) => String(item.text || "").split(/\r?\n/))
    );

    let parsed = parseReceiptData({ engineResults, lines });
    parsed.availableEngines = engineResults.filter((item) => item.available).map((item) => item.engine);
    parsed.engines = engineResults;
    parsed.warnings = [...warnings, ...(pythonOutput?.warnings || [])];

    if (
      parsed.metadata?.documentStyle === "payment_screenshot" &&
      (!parsed.fields?.totalAmount || Number(parsed.fieldConfidence?.totalAmount || 0) < 90)
    ) {
      const focusedPaymentResults = await runFocusedPaymentAmountPasses(imagePath);
      const focusedCandidate = extractPaymentAmountCandidateFromText(
        focusedPaymentResults
          .filter((item) => item.available)
          .map((item) => item.text)
          .join("\n")
      );

      if (focusedPaymentResults.length > 0) {
        parsed.engines = [...parsed.engines, ...focusedPaymentResults];
        parsed.availableEngines = parsed.engines.filter((item) => item.available).map((item) => item.engine);
      }

      parsed = mergeFocusedPaymentAmount(parsed, focusedCandidate);
    }

    try {
      if (!isPdfFile(imagePath) && !skipPython && !skipMl && shouldRunMlExtraction(parsed)) {
        const mlOutput = await runMlFieldExtractor(imagePath, {
          disablePython: skipPython,
          disableMl: skipMl,
          cropRect: normalizedCropRect,
        }).catch((error) => {
          console.warn(`Expense OCR ML extraction unavailable: ${error.message}`);
          return null;
        });
        parsed = mergeMlExtraction(parsed, mlOutput, parsed.warnings);
      }
    } catch (error) {
      console.warn(`Expense OCR ML extraction unavailable: ${error.message}`);
    }

    return {
      ...parsed,
      rawText: lines.join("\n"),
      engines: parsed.engines || engineResults,
      warnings: parsed.warnings || [...warnings, ...(pythonOutput?.warnings || [])],
      availableEngines:
        parsed.availableEngines || engineResults.filter((item) => item.available).map((item) => item.engine),
    };
  } finally {
    safeUnlink(pythonOutput?.workDir);
  }
};

module.exports = {
  extractReceiptData,
  __test: {
    parseReceiptData,
    buildAmountCandidates,
  },
};

