const router = require("express").Router();
const authenticate = require("../middlewares/auth");
const { aiQuery } = require("../controllers/reportController");

router.post("/ai-query", authenticate, aiQuery);

module.exports = router;
