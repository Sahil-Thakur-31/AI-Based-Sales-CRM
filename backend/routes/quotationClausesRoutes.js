const router = require("express").Router();
const auth = require("../middlewares/auth");
const {
  getQuotationClauses,
  createQuotationClause,
  updateQuotationClause,
  deleteQuotationClause,
  restoreQuotationClause,
  getPaymentTerms,
  upsertPaymentTerms
} = require("../controllers/quotationClausesController");

function requireAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admin only" });
  }
  next();
}

router.get("/", auth, requireAdmin, getQuotationClauses);
router.post("/", auth, requireAdmin, createQuotationClause);
router.get("/payment-terms", auth, requireAdmin, getPaymentTerms);
router.put("/payment-terms", auth, requireAdmin, upsertPaymentTerms);
router.put("/:id", auth, requireAdmin, updateQuotationClause);
router.put("/delete/:id", auth, requireAdmin, deleteQuotationClause);
router.put("/restore/:id", auth, requireAdmin, restoreQuotationClause);

module.exports = router;
