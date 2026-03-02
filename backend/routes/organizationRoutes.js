const router = require("express").Router();
const auth = require("../middlewares/auth");
const organizationLogoUpload = require("../config/organizationLogoMulter");
const {
  getOrganizations,
  getOrganizationProfile,
  createOrganization,
  upsertOrganizationProfile,
  updateOrganization,
  deleteOrganization,
  restoreOrganization
} = require("../controllers/organizationController");

function requireAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admin only" });
  }
  next();
}

router.get("/", auth, requireAdmin, getOrganizations);
router.get("/profile", auth, requireAdmin, getOrganizationProfile);
router.post("/", auth, requireAdmin, organizationLogoUpload.single("logo"), createOrganization);
router.put("/profile", auth, requireAdmin, organizationLogoUpload.single("logo"), upsertOrganizationProfile);
router.put("/:id", auth, requireAdmin, organizationLogoUpload.single("logo"), updateOrganization);
router.put("/delete/:id", auth, requireAdmin, deleteOrganization);
router.put("/restore/:id", auth, requireAdmin, restoreOrganization);

module.exports = router;
