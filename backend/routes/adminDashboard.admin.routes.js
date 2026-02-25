// Defines the Admin dashboard routes and protects them with auth + adminOnly.


const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth"); // your existing middleware
const adminOnly = require("../middlewares/adminOnly.admin");

const ctrl = require("../controllers/adminDashboard.admin.controller");

// base: /api/admin/dashboard
router.get("/summary", authenticate, adminOnly, ctrl.summary);
router.get("/pipeline", authenticate, adminOnly, ctrl.pipeline);
router.get("/team-performance", authenticate, adminOnly, ctrl.teamPerformance);
router.get("/followups", authenticate, adminOnly, ctrl.followups);
router.get("/recent-deals", authenticate, adminOnly, ctrl.recentDeals);

module.exports = router;