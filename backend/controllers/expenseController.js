const Expense = require("../models/expenses");
const Notification = require("../models/notifications");
const getNextCounter = require("../utils/getNextCounter");
require("../models/users");

const isAdmin = (role) => String(role || "").toLowerCase() === "admin";
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

exports.createExpense = async (req, res) => {
  try {
    const expenseNo = await getNextCounter("EXPENSE");
    const admin = isAdmin(req.user?.role);
    const uploadedReceiptPaths = getUploadedReceiptPaths(req);
    const existingReceiptPaths = parseExistingReceiptUrls(
      req.body.existingReceiptUrls || req.body.existingReceiptUrl
    );
    const receiptPaths = [...new Set([...uploadedReceiptPaths, ...existingReceiptPaths])];
    const primaryReceipt = receiptPaths[0] || "dummy-url";

    const payload = {
      expenseNo,
      category: req.body.category,
      otherCategory: req.body.otherCategory || "",
      amount: Number(req.body.amount),
      gstAmount: Number(req.body.gstAmount || 0),
      totalAmount: Number(req.body.totalAmount),
      expenseDate: req.body.expenseDate,
      description: req.body.description || "",
      userId: admin && req.body.userId ? req.body.userId : req.user._id,
      referenceId: req.body.referenceId || req.user._id,
      referenceType: req.body.referenceType || "Lead",
      receipt: {
        fileUrl: primaryReceipt,
      },
      receipts: buildReceipts(receiptPaths),
      approval: { status: "pending" },
    };

    if (payload.category !== "other") {
      payload.otherCategory = "";
    }

    const expense = await Expense.create(payload);
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const admin = isAdmin(req.user?.role);
    const filter = { is_deleted: false };

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

    if ("category" in req.body) expense.category = req.body.category;
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
    expense.receipt = {
      ...(expense.receipt || {}),
      fileUrl: nextReceiptPaths[0] || "dummy-url",
    };

    if (expense.category !== "other") {
      expense.otherCategory = "";
    }

    const updated = await expense.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

