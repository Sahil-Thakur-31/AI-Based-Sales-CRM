const User = require("../models/users");
const bcrypt = require("bcrypt");

/* GET ALL USERS */
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

const softDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      id,
      {
        is_deleted: true,
        is_active: false
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({ msg: "User deleted successfully" });

  } catch (err) {
    res.status(500).json({ msg: "Delete failed" });
  }
};

const activateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      id,
      {
        is_deleted: false,
        is_active: true
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({ msg: "User activated successfully" });

  } catch (err) {
    res.status(500).json({ msg: "Activation failed" });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await User.findByIdAndUpdate(
      id,
      {
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        joiningDate: req.body.joinDate
      },
      { new: true }
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ msg: "Update failed" });
  }
};


const getSingleUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .populate("role", "name");

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.status(200).json(user);

  } catch (err) {
    console.error("Get single user error:", err);
    res.status(500).json({ msg: "Failed to fetch user" });
  }
};

/* GET PROFILE */
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("role", "name")
      .select(
        "name email phone photoUrl joiningDate is_active role address dateOfBirth gender createdAt"
      );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};


/* UPDATE PROFILE */
const updateProfile = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      dateOfBirth,
      gender
    } = req.body;

    const updateData = {
      name,
      email,
      phone,
      address,
      dateOfBirth,
      gender,
      updatedAt: new Date()
    };

    if (req.file) {
      updateData.photoUrl = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    ).populate("role", "name");

    res.json(updatedUser);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Update failed" });
  }
};

const createUser = async (req, res) => {

  try {
    console.log("CREATE USER BODY:", req.body);

    const { name, email, role } = req.body;

    if (!name || !email || !role)
      return res.status(400).json({
        message: "Name, email, role required"
      });

    const exists = await User.findOne({ email });

    if (exists)
      return res.status(400).json({
        message: "Email exists"
      });

    const passwordHash = await bcrypt.hash("adcs@1234", 10);

    const user = await User.create({

      name,
      email,
      role,
      passwordHash,

      mustChangePassword: true,

      joiningDate: new Date()

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