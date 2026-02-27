const router = require("express").Router();
const authenticate = require("../middlewares/auth");
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

router.get("/", authenticate, getLeads);
router.get("/search-company", authenticate, searchCompany);
router.get("/:id", authenticate, getLeadById);
router.post("/", authenticate, createLead);
router.put("/:id/convert-to-deal", authenticate, convertLeadToDeal);
router.put("/:id/restore", authenticate, restoreLead);
router.put("/:id", authenticate, updateLead);
router.delete("/:id", authenticate, deleteLead);

module.exports = router;
