const Product = require("../models/products");



/*
GET ALL PRODUCTS
*/
exports.getProducts = async (req, res) => {

  try {

    const products = await Product.find({
      isDeleted: false
    })
    .sort({ createdAt: -1 });

    res.json(products);

  }
  catch (err) {

    res.status(500).json({
      message: "Failed to fetch products"
    });

  }

};



/*
CREATE PRODUCT
*/
exports.createProduct = async (req, res) => {

  try {

    const product = await Product.create({

      name: req.body.name,
      description: req.body.description,
      category: req.body.category,
      product_code: req.body.product_code,
      price: req.body.price,
      taxPercent: req.body.taxPercent,
      createdBy: req.user._id

    });

    res.json(product);

  }
  catch (err) {

    res.status(500).json({
      message: err.message
    });

  }

};



/*
UPDATE PRODUCT
*/
exports.updateProduct = async (req, res) => {

  try {

    const product = await Product.findByIdAndUpdate(

      req.params.id,

      req.body,

      { new: true }

    );

    res.json(product);

  }
  catch (err) {

    res.status(500).json({
      message: "Update failed"
    });

  }

};



/*
DELETE PRODUCT (soft delete)
*/
exports.deleteProduct = async (req, res) => {

  try {

    await Product.findByIdAndUpdate(

      req.params.id,

      { isDeleted: true }

    );

    res.json({
      message: "Product deleted"
    });

  }
  catch (err) {

    res.status(500).json({
      message: "Delete failed"
    });

  }

};