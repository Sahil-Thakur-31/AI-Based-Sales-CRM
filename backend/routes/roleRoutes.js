const router = require("express").Router();
const auth = require("../middlewares/auth");

const {
  getRoles,
  createRole,
  updateRole,
  deleteRole
} = require("../controllers/rolesController");

router.get("/", auth, getRoles);
router.post("/", auth, createRole);
router.put("/:id", auth, updateRole);
router.delete("/:id", auth, deleteRole);

module.exports = router;