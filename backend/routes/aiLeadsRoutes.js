const router = require("express").Router();
const authenticate = require("../middlewares/auth");
const { getAiLeads, importAiLead, getAiLeadImportAssignees } = require("../controllers/aiLeadsController");

router.get("/", authenticate, getAiLeads);
router.get("/import-assignees", authenticate, getAiLeadImportAssignees);
router.post("/:id/import", authenticate, importAiLead);

module.exports = router;
