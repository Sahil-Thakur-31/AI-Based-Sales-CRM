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

const organizationAssetUpload = organizationLogoUpload.fields([
  { name: "logo", maxCount: 1 },
  { name: "signature", maxCount: 1 },
  { name: "stamp", maxCount: 1 }
]);

function requireAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admin only" });
  }
  next();
}

router.get("/", auth, requireAdmin, getOrganizations);
router.get("/profile", auth, getOrganizationProfile);
router.post("/", auth, requireAdmin, organizationAssetUpload, createOrganization);
router.put("/profile", auth, requireAdmin, organizationAssetUpload, upsertOrganizationProfile);
router.put("/:id", auth, requireAdmin, organizationAssetUpload, updateOrganization);
router.put("/delete/:id", auth, requireAdmin, deleteOrganization);
router.put("/restore/:id", auth, requireAdmin, restoreOrganization);

module.exports = router;
