const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");

const {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct
} = require("../controllers/productController");

router.get("/", authenticate, getProducts);
router.post("/", authenticate, createProduct);
router.put("/:id", authenticate, updateProduct);
router.put("/delete/:id", authenticate, deleteProduct);
router.put("/restore/:id", authenticate, restoreProduct);

module.exports = router;