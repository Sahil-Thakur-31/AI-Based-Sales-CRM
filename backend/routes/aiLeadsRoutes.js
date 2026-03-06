const router = require("express").Router();
const authenticate = require("../middlewares/auth");
const { getAiLeads, importAiLead } = require("../controllers/aiLeadsController");

router.get("/", authenticate, getAiLeads);
router.post("/:id/import", authenticate, importAiLead);

module.exports = router;
