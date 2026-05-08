const Expense = require("../models/expenses");
const OcrFeedback = require("../models/ocrFeedback");
const Notification = require("../models/notifications");
const getNextCounter = require("../utils/getNextCounter");
const { extractReceiptData } = require("../services/expenseReceiptOcr");
const fs = require("fs").promises;
require("../models/users");

const isAdmin = (role) => String(role || "").toLowerCase() === "admin";
const normalizeVendorKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfQuarter = (date = new Date()) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
const startOfYear = (date = new Date()) => new Date(date.getFullYear(), 0, 1);
const addMonths = (date, count) => new Date(date.getFullYear(), date.getMonth() + count, 1);

function normalizeExpenseReportPeriod(period) {
  const value = String(period || "monthly").trim().toLowerCase();
  if (value === "quarterly" || value === "quarter") return "quarterly";
  if (value === "yearly" || value === "year") return "yearly";
  return "monthly";
}

function normalizeExpenseReportYear(year, now = new Date()) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 9999) {
    return now.getFullYear();
  }
  return parsed;
}

function normalizeExpenseReportMonth(month, now = new Date()) {
  const parsed = Number.parseInt(month, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return now.getMonth() + 1;
  }
  return parsed;
}

function normalizeExpenseReportQuarter(quarter, now = new Date()) {
  const value = String(quarter || "").trim().toLowerCase();
  if (["q1", "q2", "q3", "q4"].includes(value)) return value;
  const month = now.getMonth();
  if (month < 3) return "q1";
  if (month < 6) return "q2";
  if (month < 9) return "q3";
  return "q4";
}

function getExpenseReportSelection(input, now = new Date()) {
  return {
    period: normalizeExpenseReportPeriod(input?.period),
    year: normalizeExpenseReportYear(input?.year, now),
    month: normalizeExpenseReportMonth(input?.month, now),
    quarter: normalizeExpenseReportQuarter(input?.quarter, now),
  };
}

function getExpenseReportRange(input, now = new Date()) {
  const selection = getExpenseReportSelection(input, now);

  if (selection.period === "quarterly") {
    const quarterMonthMap = { q1: 0, q2: 3, q3: 6, q4: 9 };
    const start = new Date(selection.year, quarterMonthMap[selection.quarter], 1);
    return { start, end: addMonths(start, 3) };
  }

  if (selection.period === "yearly") {
    const start = new Date(selection.year, 0, 1);
    return { start, end: new Date(selection.year + 1, 0, 1) };
  }

  const start = new Date(selection.year, selection.month - 1, 1);
  return { start, end: addMonths(start, 1) };
}

const levenshteinDistance = (source, target) => {
  const a = String(source || "");
  const b = String(target || "");
  if (!a) return b.length;
  if (!b) return a.length;

  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let col = 0; col <= b.length; col += 1) {
    rows[0][col] = col;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      rows[row][col] = Math.min(
        rows[row - 1][col] + 1,
        rows[row][col - 1] + 1,
        rows[row - 1][col - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
};

const calculateVendorSimilarity = (left, right) => {
  const a = normalizeVendorKey(left);
  const b = normalizeVendorKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshteinDistance(a, b);
  const baseSimilarity = 1 - distance / Math.max(a.length, b.length, 1);
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const overlappingTokens = aTokens.filter((token) => bSet.has(token)).length;
  const tokenScore = overlappingTokens / Math.max(Math.min(aSet.size, bSet.size), 1);

  if (a.includes(b) || b.includes(a)) {
    return Math.max(baseSimilarity, 0.9);
  }

  return Math.max(baseSimilarity, tokenScore * 0.92);
};

const findNearbyVendorMatch = async (vendorName) => {
  const normalizedVendor = normalizeVendorKey(vendorName);
  if (!normalizedVendor) {
    return null;
  }

  const knownVendors = await Expense.distinct("vendorName", {
    is_deleted: false,
    vendorName: { $exists: true, $ne: null, $nin: ["", String(vendorName || "").trim()] },
  });

  let bestMatch = null;
  for (const candidate of knownVendors) {
    const normalizedCandidate = normalizeVendorKey(candidate);
    if (!normalizedCandidate) continue;

    const similarity = calculateVendorSimilarity(normalizedVendor, normalizedCandidate);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        value: String(candidate || "").trim(),
        normalizedValue: normalizedCandidate,
        similarity,
      };
    }
  }

  if (!bestMatch || bestMatch.similarity < 0.62) {
    return null;
  }

  return {
    suggestedVendor: bestMatch.value,
    similarity: Math.round(bestMatch.similarity * 100),
    autoCorrected: bestMatch.similarity >= 0.96,
  };
};

const applyVendorValidation = async (extraction) => {
  if (!extraction?.fields) {
    return {
      extraction,
      vendorValidation: null,
      validationNotes: [],
    };
  }

  const currentVendor = String(extraction.fields.vendorName || "").trim();
  if (!currentVendor) {
    return {
      extraction,
      vendorValidation: null,
      validationNotes: [],
    };
  }

  const match = await findNearbyVendorMatch(currentVendor);
  if (!match) {
    return {
      extraction,
      vendorValidation: null,
      validationNotes: [],
    };
  }

  const normalizedCurrent = normalizeVendorKey(currentVendor);
  const normalizedSuggested = normalizeVendorKey(match.suggestedVendor);
  if (!normalizedCurrent || !normalizedSuggested || normalizedCurrent === normalizedSuggested) {
    extraction.fields.vendorName = match.suggestedVendor;
    return {
      extraction,
      vendorValidation: {
        ...match,
        matchType: "canonical",
      },
      validationNotes: [],
    };
  }

  const validationNote =
    match.autoCorrected
      ? `Vendor matched with saved vendor "${match.suggestedVendor}" (${match.similarity}% similarity).`
      : `Vendor OCR looks close to saved vendor "${match.suggestedVendor}" (${match.similarity}% similarity).`;

  if (match.autoCorrected) {
    extraction.fields.vendorName = match.suggestedVendor;
  }

  return {
    extraction,
    vendorValidation: {
      ...match,
      matchType: match.autoCorrected ? "auto_corrected" : "nearby_match",
      originalVendor: currentVendor,
    },
    validationNotes: [validationNote],
  };
};

const normalizeReceiptUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/uploads/")) return value;
  return `/uploads/${value}`;
};

const getUploadedReceiptPaths = (req) => {
  if (!req?.files) return [];

  if (Array.isArray(req.files)) {
    return req.files.map((file) => `/uploads/receipt/${file.filename}`);
  }

  const fromReceipts = (req.files.receipts || []).map(
    (file) => `/uploads/receipt/${file.filename}`
  );
  const fromLegacy = (req.files.receipt || []).map(
    (file) => `/uploads/receipt/${file.filename}`
  );

  return [...fromReceipts, ...fromLegacy];
};

const parseExistingReceiptUrls = (rawValue) => {
  if (!rawValue) return [];

  if (Array.isArray(rawValue)) {
    return rawValue.map(normalizeReceiptUrl).filter(Boolean);
  }

  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeReceiptUrl).filter(Boolean);
      }
    } catch (err) {
      // Fallback to single URL string
    }

    const single = normalizeReceiptUrl(rawValue);
    return single ? [single] : [];
  }

  return [];
};

const buildReceipts = (urls) =>
  urls.map((url) => ({
    fileUrl: url,
  }));

const applyReceiptOcrMetadata = (receipt, ocrData) => {
  if (!receipt || !ocrData) return receipt;

  const fields = ocrData.fields || {};
  return {
    ...receipt,
    ocrConfidence: Number.isFinite(Number(ocrData.overallConfidence))
      ? Number(ocrData.overallConfidence)
      : undefined,
    extractedData: {
      vendor: fields.vendorName || "",
      date: fields.expenseDate || undefined,
      amount: Number.isFinite(Number(fields.amount))
        ? Number(fields.amount)
        : Number.isFinite(Number(fields.totalAmount))
          ? Number(fields.totalAmount)
          : undefined,
      gst: 0,
      currency: fields.currencyCode || "INR",
    },
  };
};

const getFirstUploadedReceiptFile = (req) => {
  if (!req?.files) return null;
  if (Array.isArray(req.files)) return req.files[0] || null;
  return (req.files.receipt || [])[0] || (req.files.receipts || [])[0] || null;
};

const parseJsonField = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const parseBooleanField = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["true", "1", "yes", "y", "on"].includes(normalized);
};

exports.extractExpenseReceipt = async (req, res) => {
  const receiptFile = getFirstUploadedReceiptFile(req);
  try {
    if (!receiptFile) {
      return res.status(400).json({ message: "Receipt file is required" });
    }

    const extraction = await extractReceiptData({
      imagePath: receiptFile.path,
      cropRect: parseJsonField(req.body.cropRect),
      rotation: Number(req.body.rotation || 0),
      brightness: Number(req.body.brightness || 100),
      contrast: Number(req.body.contrast || 100),
      disablePython: parseBooleanField(req.body.disablePython),
      disableMl: parseBooleanField(req.body.disableMl),
    });
    const vendorCheck = await applyVendorValidation(extraction);

    const validation = [];
    if (!vendorCheck.extraction.fields.totalAmount) {
      validation.push("Total amount was not extracted confidently.");
    }
    if (!vendorCheck.extraction.fields.expenseDate) {
      validation.push("Receipt date is unclear.");
    }
    if (vendorCheck.extraction.fields.currencyCode && vendorCheck.extraction.fields.currencyCode !== "INR") {
      validation.push(`Detected ${vendorCheck.extraction.fields.currencyCode} currency. Verify the amount before saving.`);
    }
    validation.push(...vendorCheck.validationNotes);

    const extractionResponse = {
      ...vendorCheck.extraction,
    };
    delete extractionResponse.fieldConfidence;

    res.json({
      message: "Receipt OCR completed",
      ...extractionResponse,
      validation,
      vendorValidation: vendorCheck.vendorValidation,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message || "Receipt OCR failed",
    });
  } finally {
    if (receiptFile && receiptFile.path) {
      try {
        await fs.unlink(receiptFile.path);
      } catch (err) {
        console.error("Failed to delete temp OCR file:", err);
      }
    }
  }
};

exports.createExpense = async (req, res) => {
  try {
    const expenseNo = await getNextCounter("EXPENSE");
    const admin = isAdmin(req.user?.role);
    const uploadedReceiptPaths = getUploadedReceiptPaths(req);
    const existingReceiptPaths = parseExistingReceiptUrls(
      req.body.existingReceiptUrls || req.body.existingReceiptUrl
    );
    const receiptOcrData = parseJsonField(req.body.receiptOcrData);
    const receiptPaths = [...new Set([...uploadedReceiptPaths, ...existingReceiptPaths])];
    const primaryReceipt = receiptPaths[0] || "dummy-url";
    const receipts = buildReceipts(receiptPaths);
    if (receipts[0]) {
      receipts[0] = applyReceiptOcrMetadata(receipts[0], receiptOcrData);
    }

    const payload = {
      expenseNo,
      category: req.body.category,
      vendorName: req.body.vendorName || "",
      otherCategory: req.body.otherCategory || "",
      amount: Number(req.body.amount),
      gstAmount: Number(req.body.gstAmount || 0),
      totalAmount: Number(req.body.totalAmount),
      expenseDate: req.body.expenseDate,
      description: req.body.description || "",
      userId: admin && req.body.userId ? req.body.userId : req.user._id,
      referenceId: req.body.referenceId || req.user._id,
      referenceType: req.body.referenceType || "Lead",
      receipt: applyReceiptOcrMetadata({
        fileUrl: primaryReceipt,
      }, receiptOcrData),
      receipts,
      approval: { status: "pending" },
    };

    if (payload.category !== "other") {
      payload.otherCategory = "";
    }

    const expense = await Expense.create(payload);

    if (receiptOcrData) {
      try {
        await OcrFeedback.create({
          originalExtraction: receiptOcrData,
          finalData: {
            vendorName: payload.vendorName,
            amount: payload.amount,
            expenseDate: payload.expenseDate,
            category: payload.category,
            totalAmount: payload.totalAmount,
          },
          imagePath: primaryReceipt,
          userId: req.user._id,
        });
      } catch (feedbackErr) {
        console.error("Failed to save OCR feedback:", feedbackErr);
      }
    }
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const admin = isAdmin(req.user?.role);
    const filter = { is_deleted: false };
    const { start, end } = getExpenseReportRange(req.query, new Date());

    filter.expenseDate = { $gte: start, $lt: end };

    if (!admin) {
      filter.userId = req.user._id;
    }

    const expenses = await Expense.find(filter)
      .populate("userId", "name email")
      .sort({ expenseDate: -1, updatedAt: -1 });

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, is_deleted: false });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const admin = isAdmin(req.user?.role);
    const isOwner = String(expense.userId) === String(req.user._id);

    if (!admin && !isOwner) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (!admin && expense.approval?.status === "approved") {
      return res.status(400).json({ message: "Cannot delete approved expense" });
    }

    expense.is_deleted = true;
    await expense.save();

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.approveExpense = async (req, res) => {
  try {
    if (!isAdmin(req.user?.role)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const expense = await Expense.findOne({ _id: req.params.id, is_deleted: false });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    expense.approval.status = "approved";
    expense.approval.approvedBy = req.user._id;
    expense.approval.approvedAt = new Date();
    await expense.save();

    await Notification.create({
      userId: expense.userId,
      title: "Expense Approved",
      message: `Your expense #${expense.expenseNo} has been approved.`,
      type: "success",
      relatedId: expense._id,
      relatedType: "expense",
    });

    res.json({ message: "Expense Approved", expense });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateExpenseStatus = async (req, res) => {
  try {
    if (!isAdmin(req.user?.role)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { status, reason } = req.body || {};
    const allowed = ["pending", "approved", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (status === "rejected" && !String(reason || "").trim()) {
      return res.status(400).json({ message: "Reject reason is required" });
    }

    const expense = await Expense.findOne({ _id: req.params.id, is_deleted: false });
    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (expense.approval?.status === "approved" && status !== "approved") {
      return res.status(400).json({ message: "Approved expense status cannot be changed" });
    }

    expense.approval.status = status;
    if (status === "pending") {
      expense.approval.approvedBy = null;
      expense.approval.approvedAt = null;
      expense.approval.remarks = "";
    } else {
      expense.approval.approvedBy = req.user._id;
      expense.approval.approvedAt = new Date();
      expense.approval.remarks = status === "rejected" ? String(reason).trim() : "";
    }

    await expense.save();

    if (status === "approved") {
      await Notification.create({
        userId: expense.userId,
        title: "Expense Approved",
        message: `Your expense #${expense.expenseNo} has been approved.`,
        type: "success",
        relatedId: expense._id,
        relatedType: "expense",
      });
    }

    if (status === "rejected") {
      await Notification.create({
        userId: expense.userId,
        title: "Expense Rejected",
        message: `Your expense #${expense.expenseNo} was rejected. Reason: ${expense.approval.remarks}`,
        type: "warning",
        relatedId: expense._id,
        relatedType: "expense",
      });
    }

    res.json({ message: "Expense status updated", expense });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, is_deleted: false });

    if (!expense) {
      return res.status(404).json({ message: "Not found" });
    }

    const admin = isAdmin(req.user?.role);
    const isOwner = String(expense.userId) === String(req.user._id);

    if (!admin && !isOwner) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (expense.approval?.status === "approved") {
      return res.status(400).json({ message: "Cannot edit approved expense" });
    }

    const uploadedReceiptPaths = getUploadedReceiptPaths(req);
    const receiptOcrData = parseJsonField(req.body.receiptOcrData);

    if ("category" in req.body) expense.category = req.body.category;
    if ("vendorName" in req.body) expense.vendorName = req.body.vendorName;
    if ("otherCategory" in req.body) expense.otherCategory = req.body.otherCategory;
    if ("amount" in req.body) expense.amount = Number(req.body.amount);
    if ("gstAmount" in req.body) expense.gstAmount = Number(req.body.gstAmount);
    if ("totalAmount" in req.body) expense.totalAmount = Number(req.body.totalAmount);
    if ("expenseDate" in req.body) expense.expenseDate = req.body.expenseDate;
    if ("description" in req.body) expense.description = req.body.description;
    if ("referenceId" in req.body) expense.referenceId = req.body.referenceId;
    if ("referenceType" in req.body) expense.referenceType = req.body.referenceType;

    const existingReceiptPaths = parseExistingReceiptUrls(
      req.body.existingReceiptUrls || req.body.existingReceiptUrl
    );
    const currentReceiptPaths = Array.isArray(expense.receipts)
      ? expense.receipts.map((item) => item?.fileUrl).filter(Boolean)
      : [];
    const legacyPath = expense.receipt?.fileUrl;
    if (legacyPath && legacyPath !== "dummy-url" && !currentReceiptPaths.includes(legacyPath)) {
      currentReceiptPaths.unshift(legacyPath);
    }

    const shouldReplaceReceipts =
      Object.prototype.hasOwnProperty.call(req.body || {}, "existingReceiptUrls") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "existingReceiptUrl") ||
      uploadedReceiptPaths.length > 0;

    const nextReceiptPaths = shouldReplaceReceipts
      ? [...new Set([...existingReceiptPaths, ...uploadedReceiptPaths])]
      : currentReceiptPaths;

    expense.receipts = buildReceipts(nextReceiptPaths);
    if (expense.receipts[0]) {
      expense.receipts[0] = applyReceiptOcrMetadata(expense.receipts[0], receiptOcrData);
    }
    expense.receipt = applyReceiptOcrMetadata({
      ...(expense.receipt || {}),
      fileUrl: nextReceiptPaths[0] || "dummy-url",
    }, receiptOcrData);

    if (expense.category !== "other") {
      expense.otherCategory = "";
    }

    const updated = await expense.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

