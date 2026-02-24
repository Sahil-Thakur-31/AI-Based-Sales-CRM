const Industry = require("../models/industries");


/* GET ALL INDUSTRIES (exclude deleted) */
exports.getIndustries = async (req, res) => {

  try {

    const data = await Industry.find({
      is_deleted: false
    })
    .sort({ name: 1 });

    res.json(data);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch industries"
    });

  }

};


/* CREATE INDUSTRY */
exports.createIndustry = async (req, res) => {

  try {

    const industry = await Industry.create({

      name: req.body.name,

      description: req.body.description,

      code: req.body.code,

      createdAt: new Date(),

      is_deleted: false

    });

    res.json(industry);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to create industry"
    });

  }

};


/* UPDATE INDUSTRY */
exports.updateIndustry = async (req, res) => {

  try {

    const industry = await Industry.findByIdAndUpdate(

      req.params.id,

      {

        name: req.body.name,

        description: req.body.description,

        code: req.body.code,

        updatedAt: new Date()

      },

      { returnDocument: "after" }

    );

    res.json(industry);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to update industry"
    });

  }

};


/* SOFT DELETE INDUSTRY */
exports.deleteIndustry = async (req, res) => {

  try {

    await Industry.findByIdAndUpdate(

      req.params.id,

      {

        is_deleted: true,

        updatedAt: new Date()

      }

    );

    res.json({

      message: "Industry deleted successfully"

    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({

      message: "Delete failed"

    });

  }

};


/* RESTORE INDUSTRY (optional but recommended) */
exports.activateIndustry = async (req, res) => {

  try {

    await Industry.findByIdAndUpdate(

      req.params.id,

      {

        is_deleted: false,

        updatedAt: new Date()

      }

    );

    res.json({

      message: "Industry restored successfully"

    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({

      message: "Restore failed"

    });

  }

};