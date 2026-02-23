const User = require("../models/users");

/* GET ALL USERS */
const getAllUsers = async (req, res) => {
  try {
    console.log('users');
    const users = await User.find({})
      .populate("role", "name")
      .select("name email role is_active createdAt");

    res.status(200).json(users);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch users" });
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

module.exports = {
  getProfile,
  updateProfile,
  getAllUsers,
  updateUser,
  getSingleUser
};