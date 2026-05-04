const express = require("express");
const authenticate = require("../middlewares/auth");
const controller = require("../controllers/salesForecastController");

const router = express.Router();

router.get("/", authenticate, controller.getForecast);

module.exports = router; 
