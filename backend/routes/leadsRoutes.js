const router = require("express").Router();
const {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  restoreLead,
  convertLeadToDeal,
  searchCompany,
} = require("../controllers/leadsController");

router.get("/", getLeads);
router.get("/search-company", searchCompany);
router.get("/:id", getLeadById);
router.post("/", createLead);
router.put("/:id/convert-to-deal", convertLeadToDeal);
router.put("/:id/restore", restoreLead);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

module.exports = router;
