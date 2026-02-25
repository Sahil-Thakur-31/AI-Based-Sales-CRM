const Tax = require("../models/taxes");

exports.getTaxes = async (req, res) => {

  try {

    const taxes = await Tax.find({
      is_deleted: false
    })
    .sort({ rate: 1 });

    res.json(taxes);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch taxes"
    });

  }

};

exports.createTax = async (req, res) => {

  try {

    const tax = await Tax.create({
      rate: req.body.rate,
      createdBy: req.user._id,
      is_deleted: false
    });

    res.status(201).json(tax);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: err.message || "Failed to create tax"
    });

  }

};

exports.updateTax = async (req, res) => {

  try {

    const tax = await Tax.findOneAndUpdate(

      {
        _id: req.params.id,
        is_deleted: false
      },

      {
        rate: req.body.rate,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!tax) {
      return res.status(404).json({
        message: "Tax not found"
      });
    }

    res.json(tax);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to update tax"
    });

  }

};

exports.deleteTax = async (req, res) => {

  try {

    const tax = await Tax.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: true,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!tax) {
      return res.status(404).json({
        message: "Tax not found"
      });
    }

    res.json({
      message: "Tax deleted successfully"
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to delete tax"
    });

  }

};

exports.restoreTax = async (req, res) => {

  try {

    const tax = await Tax.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: false,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!tax) {
      return res.status(404).json({
        message: "Tax not found"
      });
    }

    res.json({
      message: "Tax restored successfully"
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to restore tax"
    });

  }

};
