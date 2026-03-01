const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { getDeals, getDealById, updateDeal, deleteDeal, restoreDeal } = require("../controllers/dealsController");

router.get("/client-suggestions", authenticate, getClientSuggestions);
router.get("/", authenticate, getDeals);
router.get("/:id", authenticate, getDealById);
router.put("/:id/restore", authenticate, restoreDeal);
router.put("/:id", authenticate, updateDeal);
router.delete("/:id", authenticate, deleteDeal);

module.exports = router;
