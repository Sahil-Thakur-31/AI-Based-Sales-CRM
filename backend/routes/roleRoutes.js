const router = require("express").Router();
const auth = require("../middlewares/auth");

const {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  restoreRole
} = require("../controllers/rolesController");

router.get("/", auth, getRoles);
router.post("/", auth, createRole);
router.put("/:id", auth, updateRole);
router.put("/delete/:id", auth, deleteRole);
router.put("/restore/:id", auth, restoreRole);

module.exports = router;