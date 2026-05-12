const express = require("express");
const router = express.Router();
const controller = require("../controllers/expenseController");
const authenticate = require("../middlewares/auth");
const expenseUpload = require("../config/expenseMulter");

const withExpenseUpload = (fields) => (req, res, next) =>
  expenseUpload.fields(fields)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    let message = error.message || "Receipt upload failed";
    if (error.code === "LIMIT_FILE_SIZE") {
      message = "Receipt file is too large. Maximum allowed size is 10 MB.";
    } else if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      message = "Too many receipt files were uploaded.";
    }

    res.status(400).json({ message });
  });

router.get("/", authenticate, controller.getExpenses);
router.get("/reports/analytics", authenticate, controller.getExpenseReportAnalytics);
router.post(
  "/ocr/extract",
  authenticate,
  withExpenseUpload([
    { name: "receipt", maxCount: 1 },
    { name: "receipts", maxCount: 1 },
  ]),
  controller.extractExpenseReceipt
);
router.post(
  "/",
  authenticate,
  withExpenseUpload([
    { name: "receipts", maxCount: 10 },
    { name: "receipt", maxCount: 1 },
  ]),
  controller.createExpense
);
router.delete("/:id", authenticate, controller.deleteExpense);
router.put("/approve/:id", authenticate, controller.approveExpense);
router.put("/status/:id", authenticate, controller.updateExpenseStatus);
router.put(
  "/:id",
  authenticate,
  withExpenseUpload([
    { name: "receipts", maxCount: 10 },
    { name: "receipt", maxCount: 1 },
  ]),
  controller.updateExpense
);

module.exports = router;
