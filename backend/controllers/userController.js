const User = require("../models/users");
const bcrypt = require("bcrypt");


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

      role: user.role?.name || "",

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

    const updated = await User.findOneAndUpdate(

      {
        _id: id,
        is_deleted: { $ne: true }
      },

      {
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        joiningDate: req.body.joinDate,
        updatedAt: new Date()
      },

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
      updateData.photoUrl = `/uploads/${req.file.filename}`;


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
      role,
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