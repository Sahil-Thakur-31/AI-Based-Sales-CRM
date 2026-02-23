const express = require("express");

const router = express.Router();

const authenticate = require("../middlewares/auth");

const {

  getProducts,
  createProduct,
  updateProduct,
  deleteProduct

} = require("../controllers/productController");



router.get("/", authenticate, getProducts);

router.post("/", authenticate, createProduct);

router.put("/:id", authenticate, updateProduct);

router.delete("/:id", authenticate, deleteProduct);



module.exports = router;