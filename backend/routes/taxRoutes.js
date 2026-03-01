const router = require("express").Router();
const auth = require("../middlewares/auth");
const {
  getTaxes,
  createTax,
  updateTax,
  deleteTax,
  activateTax
} = require("../controllers/taxController");

router.get("/", auth, getTaxes);
router.post("/", auth, createTax);
router.put("/:id", auth, updateTax);
router.put("/delete/:id", auth, deleteTax);
router.put("/activate/:id", auth, activateTax);

module.exports = router;
