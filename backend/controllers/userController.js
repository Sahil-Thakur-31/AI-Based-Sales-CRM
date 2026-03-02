const User = require("../models/users");
const Role = require("../models/roles");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const resolveRoleId = async (roleValue) => {

  if (!roleValue) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(roleValue)) {

    const roleDoc = await Role.findOne({
      _id: roleValue,
      is_deleted: false
    })
    .select("_id")
    .lean();

    return roleDoc ? roleDoc._id : null;

  }

  const roleDoc = await Role.findOne({
    name: roleValue,
    is_deleted: false
  })
  .select("_id")
  .lean();

  return roleDoc ? roleDoc._id : null;

};


/* GET ALL USERS (exclude deleted) */
const getAllUsers = async (req, res) => {

  try {

    const users = await User.find({
      is_deleted: { $ne: true }
    })
    .populate("role", "name")
    .sort({ createdAt: -1 });


    const formatted = users.map(user => ({

      _id: user._id,

      name: user.name,

      email: user.email,

      role: user.role?._id ? String(user.role._id) : "",

      roleName: user.role?.name || "",

      is_active: user.is_active,

      createdAt: user.createdAt

    }));


    res.json(formatted);

  }
  catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Failed to fetch users"
    });

  }

};



/* SOFT DELETE USER */
const softDeleteUser = async (req, res) => {

  try {

    const user = await User.findOneAndUpdate(

      {
        _id: req.params.id,
        is_deleted: { $ne: true }
      },

      {
        is_deleted: true,
        is_active: false
      },

      {
        returnDocument: "after"
      }

    );

    if (!user)
      return res.status(404).json({
        message: "User not found"
      });

    res.json({
      message: "User deleted",
      user
    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Delete failed"
    });

  }

};



/* ACTIVATE USER */
const activateUser = async (req, res) => {

  try {

    const { id } = req.params;

    const user = await User.findByIdAndUpdate(

      id,

      {
        is_deleted: false,
        is_active: true,
        updatedAt: new Date()
      },

      { returnDocument: "after" }

    );

    if (!user)
      return res.status(404).json({
        message: "User not found"
      });

    res.json({
      message: "User activated successfully"
    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Activation failed"
    });

  }

};



/* UPDATE USER (only if not deleted) */
const updateUser = async (req, res) => {

  try {

    const { id } = req.params;
    const roleId = await resolveRoleId(req.body.role);

    if (!roleId) {
      return res.status(400).json({
        message: "Invalid role"
      });
    }

    const updatePayload = {
      name: req.body.name,
      email: req.body.email,
      role: roleId,
      updatedAt: new Date()
    };

    if (req.body.joiningDate || req.body.joinDate) {
      updatePayload.joiningDate = req.body.joiningDate || req.body.joinDate;
    }

    const updated = await User.findOneAndUpdate(

      {
        _id: id,
        is_deleted: { $ne: true }
      },

      updatePayload,

      { returnDocument: "after" }

    );

    if (!updated)
      return res.status(404).json({
        message: "User not found or deleted"
      });

    res.json(updated);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Update failed"
    });

  }

};



/* GET SINGLE USER (exclude deleted) */
const getSingleUser = async (req, res) => {

  try {

    const { id } = req.params;

    const user = await User.findOne({

      _id: id,
      is_deleted: { $ne: true }

    })
    .populate("role", "name");


    if (!user)
      return res.status(404).json({
        message: "User not found"
      });

    res.json(user);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch user"
    });

  }

};



/* GET PROFILE */
const getProfile = async (req, res) => {

  try {

    const user = await User.findOne({

      _id: req.user._id,
      is_deleted: { $ne: true }

    })
    .populate("role", "name")
    .select(
      "name email phone photoUrl joiningDate is_active role address dateOfBirth gender createdAt"
    );


    if (!user)
      return res.status(404).json({
        message: "User not found"
      });

    res.json(user);

  }
  catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Server error"
    });

  }

};



/* UPDATE PROFILE */
const updateProfile = async (req, res) => {

  try {

    const updateData = {

      name: req.body.name,

      email: req.body.email,

      phone: req.body.phone,

      address: req.body.address,

      dateOfBirth: req.body.dateOfBirth,

      gender: req.body.gender,

      updatedAt: new Date()

    };

    if (req.file)
      updateData.photoUrl = `/uploads/profile_picture/${req.file.filename}`;


    const updatedUser = await User.findOneAndUpdate(

      {
        _id: req.user._id,
        is_deleted: { $ne: true }
      },

      updateData,

      {
        returnDocument: "after",
        runValidators: true
      }

    )
    .populate("role", "name");


    res.json(updatedUser);

  }
  catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Update failed"
    });

  }

};

/* CREATE USER */
const createUser = async (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email || !role)
      return res.status(400).json({
        message: "Name, email, role required"
      });

    const roleId = await resolveRoleId(role);

    if (!roleId)
      return res.status(400).json({
        message: "Invalid role"
      });

    const exists = await User.findOne({
      email,
      is_deleted: { $ne: true }
    });

    if (exists)
      return res.status(400).json({
        message: "Email already exists"
      });
    const passwordHash = await bcrypt.hash("adcs@1234", 10);

    const user = await User.create({
      name,
      email,
      role: roleId,
      passwordHash,
      joiningDate: new Date(),
      is_deleted: false,
      is_active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    res.status(201).json(user);
  }
  catch (err) {
    console.error(err);
    res.status(500).json({
      message: err.message
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getAllUsers,
  updateUser,
  getSingleUser,
  softDeleteUser,
  activateUser,
  createUser
};
