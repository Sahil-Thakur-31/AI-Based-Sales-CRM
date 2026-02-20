// routes/userRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const User = require("../models/users");


router.get("/me", authenticate, async (req, res) => {

  try {

    console.log("Fetching profile for:", req.user._id);

    const user = await User.findById(req.user._id)
      .populate("role", "name")
      .select(
        "name email phone photoUrl joiningDate is_active role createdAt"
      );

    if (!user)
      return res.status(404).json({
        message: "User not found",
        idUsed: req.user._id
      });

    res.json(user);

  }
  catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Server error"
    });

  }

});

router.put("/me", authenticate, async (req, res) => {

  try {

    const { name, email, phone, photoUrl } = req.body;

    const updatedUser = await User.findByIdAndUpdate(

      req.user._id,

      {
        name,
        email,
        phone,
        photoUrl,
        updatedAt: new Date()
      },

      {
        new: true,
        runValidators: true
      }

    ).populate("role", "name");

    res.json(updatedUser);

  }
  catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Update failed"
    });

  }

});


module.exports = router;
