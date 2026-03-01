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

router.get("/", auth, getClients);
router.get("/:id", auth, getClientById);
router.post("/", auth, createClient);
router.put("/:id", auth, updateClient);
router.put("/delete/:id", auth, deleteClient);
router.put("/activate/:id", auth, activateClient);

module.exports = router;
