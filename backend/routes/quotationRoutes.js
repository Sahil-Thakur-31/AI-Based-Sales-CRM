const router = require("express").Router();
const auth = require("../middlewares/auth");
const {
  getQuotations,
  getQuotationById,
  createQuotation,
  updateQuotationStatus,
  deleteQuotation
} = require("../controllers/quotationController");

router.get("/", auth, getQuotations);
router.get("/:id", auth, getQuotationById);
router.post("/", auth, createQuotation);
router.put("/:id/status", auth, updateQuotationStatus);
router.put("/delete/:id", auth, deleteQuotation);

module.exports = router;
