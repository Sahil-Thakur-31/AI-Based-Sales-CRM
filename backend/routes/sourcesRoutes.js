const router = require("express").Router();
const auth = require("../middlewares/auth");

const {
  getSources,
  createSource,
  updateSource,
  deleteSource,
  activateSource
} = require("../controllers/sourcesController");

router.get("/", auth, getSources);
router.post("/", auth, createSource);
router.put("/:id", auth, updateSource);
router.put("/delete/:id", auth, deleteSource);
router.put("/activate/:id", auth, activateSource);

module.exports = router;