const router = require("express").Router();
const {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  restoreLead,
  convertLeadToDeal,
} = require("../controllers/leadsController");

router.get("/", getLeads);
router.get("/:id", getLeadById);
router.post("/", createLead);
router.put("/:id", updateLead);
router.put("/:id/convert-to-deal", convertLeadToDeal);
router.put("/:id/restore", restoreLead);
router.delete("/:id", deleteLead);

module.exports = router;
