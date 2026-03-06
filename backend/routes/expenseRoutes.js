const express = require("express");
const router = express.Router();
const controller = require("../controllers/expenseController");
const authenticate = require("../middlewares/auth");
const expenseUpload = require("../config/expenseMulter");

router.get("/", authenticate, controller.getExpenses);
router.post(
  "/",
  authenticate,
  expenseUpload.fields([
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
  expenseUpload.fields([
    { name: "receipts", maxCount: 10 },
    { name: "receipt", maxCount: 1 },
  ]),
  controller.updateExpense
);

module.exports = router;
