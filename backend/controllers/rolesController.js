const Role = require("../models/roles");

/* GET ALL */
exports.getRoles = async (req, res) => {

  try {

    const roles = await Role.find()
      .populate("createdBy", "name")
      .sort({ name: 1 });

    res.json(roles);

  }
  catch (err) {

    res.status(500).json({ message: "Failed to fetch roles" });

  }

};



/* CREATE */
exports.createRole = async (req, res) => {

  try {

    const role = await Role.create({

      name: req.body.name,
      description: req.body.description,
      createdBy: req.user._id,
      createdAt: new Date()

    });

    res.json(role);

  }
  catch (err) {

    res.status(500).json({ message: "Create failed" });

  }

};



/* UPDATE */
exports.updateRole = async (req, res) => {

  try {

    const role = await Role.findByIdAndUpdate(

      req.params.id,

      {
        name: req.body.name,
        description: req.body.description,
        updatedAt: new Date()
      },

      { new: true }

    );

    res.json(role);

  }
  catch (err) {

    res.status(500).json({ message: "Update failed" });

  }

};



/* DELETE */
exports.deleteRole = async (req, res) => {

  try {

    await Role.findByIdAndDelete(req.params.id);

    res.json({ message: "Deleted successfully" });

  }
  catch {

    res.status(500).json({ message: "Delete failed" });

  }

};