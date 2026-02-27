const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { getDeals, getClientSuggestions } = require("../controllers/dealsController");

router.get("/client-suggestions", authenticate, getClientSuggestions);
router.get("/", authenticate, getDeals);

module.exports = router;
