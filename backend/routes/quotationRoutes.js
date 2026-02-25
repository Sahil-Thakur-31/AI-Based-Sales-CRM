const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const {
  getQuotations,
  createQuotation,
  deleteQuotation
} = require("../controllers/quotationController");

router.get("/", authenticate, getQuotations);
router.post("/", authenticate, createQuotation);
router.put("/delete/:id", authenticate, deleteQuotation);

module.exports = router;
