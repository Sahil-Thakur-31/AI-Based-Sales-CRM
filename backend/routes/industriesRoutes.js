const router = require("express").Router();
const auth = require("../middlewares/auth");

const {
  getIndustries,
  createIndustry,
  updateIndustry,
  deleteIndustry,
  activateIndustry
} = require("../controllers/industriesController");

router.get("/", auth, getIndustries);
router.post("/", auth, createIndustry);
router.put("/:id", auth, updateIndustry);
router.put("/delete/:id", auth, deleteIndustry);
router.put("/activate/:id", auth, activateIndustry);

module.exports = router;