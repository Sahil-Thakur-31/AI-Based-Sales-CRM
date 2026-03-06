const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth");
const ctrl = require("../controllers/userDashboardController");

router.get("/", authenticate, ctrl.getDashboard);

module.exports = router;
