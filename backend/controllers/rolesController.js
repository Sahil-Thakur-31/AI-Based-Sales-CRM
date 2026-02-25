const Role = require("../models/roles");


/*
GET ALL ROLES (exclude deleted)
*/
exports.getRoles = async (req, res) => {

  try {

    const roles = await Role.find({
      is_deleted: false
    })
    .populate("createdBy", "name")
    .sort({ name: 1 });

    res.json(roles);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch roles"
    });

  }

};



/*
CREATE ROLE
*/
exports.createRole = async (req, res) => {

  try {

    const role = await Role.create({

      name: req.body.name,

      description: req.body.description,

      createdBy: req.user._id,

      createdAt: new Date(),

      is_deleted: false

    });

    res.status(201).json(role);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Create failed"
    });

  }

};



/*
UPDATE ROLE (only if not deleted)
*/
exports.updateRole = async (req, res) => {

  try {

    const role = await Role.findOneAndUpdate(

      {
        _id: req.params.id,
        is_deleted: false
      },

      {
        name: req.body.name,

        description: req.body.description,

        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!role) {

      return res.status(404).json({
        message: "Role not found or deleted"
      });

    }

    res.json(role);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Update failed"
    });

  }

};



/*
SOFT DELETE ROLE
*/
exports.deleteRole = async (req, res) => {

  try {

    const role = await Role.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: true,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    if (!role) {

      return res.status(404).json({
        message: "Role not found"
      });

    }

    res.json({
      message: "Role deleted successfully"
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
RESTORE ROLE (optional but recommended)
*/
exports.restoreRole = async (req, res) => {

  try {

    const role = await Role.findByIdAndUpdate(

      req.params.id,

      {
        is_deleted: false,
        updatedAt: new Date()
      },

      {
        returnDocument: "after"
      }

    );

    res.json({
      message: "Role restored successfully"
    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Restore failed"
    });

  }

};