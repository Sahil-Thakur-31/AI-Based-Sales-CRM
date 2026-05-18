const express = require("express");
const authenticate = require("../middlewares/auth");
const dailyClosingController = require("../controllers/dailyClosingController");

const router = express.Router();

router.post("/submit", authenticate, dailyClosingController.submit);
router.post("/mail-report", authenticate, dailyClosingController.mailReport);
router.get("/calendar-self", authenticate, dailyClosingController.listForCalendar);
router.get("/report-data", authenticate, dailyClosingController.reportData);

module.exports = router;
