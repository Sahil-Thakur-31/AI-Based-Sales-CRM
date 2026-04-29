const Product = require("../models/products");
const Tax = require("../models/taxes");

const resolveTaxPayload = async (taxId) => {

  if (!taxId) {
    return {
      taxId: null,
      taxPercent: 0
    };
  }

  const tax = await Tax.findOne({
    _id: taxId,
    is_deleted: false
  })
  .select("rate")
  .lean();

  if (!tax) {
    throw new Error("Selected tax is invalid or deleted");
  }

  return {
    taxId,
    taxPercent: tax.rate
  };

};


/*
GET ALL PRODUCTS (exclude deleted)
*/
exports.getProducts = async (req, res) => {

  try {

    const status = String(req.query?.status || "active").trim().toLowerCase();
    const filter = {};

    if (status === "deleted") {
      filter.is_deleted = true;
    }
    else if (status !== "all") {
      filter.is_deleted = false;
    }

    const products = await Product.find({
      ...filter
    })
    .sort({ createdAt: -1 });

    res.json(products);

  }
  catch (err) {

    console.error(err);

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

    const taxPayload = await resolveTaxPayload(req.body.taxId);

    const product = await Product.create({

      name: req.body.name,

      description: req.body.description,

      category: req.body.category,

      price: req.body.price,

      taxPercent: taxPayload.taxPercent,

      taxId: taxPayload.taxId,

      createdBy: req.user._id,

      createdAt: new Date(),

      updatedAt: new Date(),

      is_deleted: false

    });

    res.status(201).json(product);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: err.message
    });

  }

};



/*
UPDATE PRODUCT (only if not deleted)
*/
exports.updateProduct = async (req, res) => {

  try {

    const updatePayload = {
      ...req.body,
      updatedAt: new Date()
    };

    if (Object.prototype.hasOwnProperty.call(req.body, "taxId")) {
      const taxPayload = await resolveTaxPayload(req.body.taxId);
      updatePayload.taxId = taxPayload.taxId;
      updatePayload.taxPercent = taxPayload.taxPercent;
    }

    const product = await Product.findOneAndUpdate(

      {
        _id: req.params.id,
        is_deleted: false
      },

      updatePayload,

      {
        returnDocument: "after"
      }

    );

    if (!product) {

      return res.status(404).json({
        message: "Product not found or already deleted"
      });

    }

    res.json(product);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Update failed"
    });

  }

};



/*
SOFT DELETE PRODUCT
*/
exports.deleteProduct = async (req, res) => {

  try {

    const product = await Product.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: true,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!product) {

      return res.status(404).json({
        message: "Product not found"
      });

    }

    res.json({
      message: "Product deleted successfully"
    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Delete failed"
    });

  }

};



/*
RESTORE PRODUCT (optional but highly recommended)
*/
exports.restoreProduct = async (req, res) => {

  try {

    const product = await Product.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: false,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!product) {

      return res.status(404).json({
        message: "Product not found"
      });

    }

    res.json({
      message: "Product restored successfully"
    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Restore failed"
    });

  }

};
