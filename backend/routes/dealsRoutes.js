const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { getDeals, getDealById, updateDeal } = require("../controllers/dealsController");

router.get("/", authenticate, getDeals);
router.get("/:id", authenticate, getDealById);
router.put("/:id", authenticate, updateDeal);

module.exports = router;