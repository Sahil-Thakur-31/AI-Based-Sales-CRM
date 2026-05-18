const router = require("express").Router();
const auth = require("../middlewares/auth");
const {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  activateClient
} = require("../controllers/clientController");

function requireAdminOrManager(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin" && role !== "manager") {
    return res.status(403).json({ message: "Users can only view clients" });
  }
  next();
}

router.get("/", auth, getClients);
router.get("/:id", auth, getClientById);
router.post("/", auth, requireAdminOrManager, createClient);
router.put("/delete/:id", auth, requireAdminOrManager, deleteClient);
router.put("/activate/:id", auth, requireAdminOrManager, activateClient);
router.put("/:id", auth, requireAdminOrManager, updateClient);

module.exports = router;
