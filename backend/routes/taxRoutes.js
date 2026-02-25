const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");

const {
  getTaxes,
  createTax,
  updateTax,
  deleteTax,
  restoreTax
} = require("../controllers/taxController");

router.get("/", authenticate, getTaxes);
router.post("/", authenticate, createTax);
router.put("/:id", authenticate, updateTax);
router.put("/delete/:id", authenticate, deleteTax);
router.put("/restore/:id", authenticate, restoreTax);

module.exports = router;
