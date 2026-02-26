const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const {
  listClients,
  getClientById,
  updateClient
} = require("../controllers/clientController");

router.get("/", authenticate, listClients);
router.get("/:id", authenticate, getClientById);
router.put("/:id", authenticate, updateClient);

module.exports = router;
