const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { getDeals } = require("../controllers/dealsController");

router.get("/", authenticate, getDeals);

module.exports = router;
