const router = require("express").Router();
const authenticate = require("../middlewares/auth");
const aiInsightController = require("../controllers/aiInsightController");

router.get("/", authenticate, aiInsightController.fetchInsights);
router.get("/analyze", authenticate, aiInsightController.fetchInsights);

module.exports = router;
