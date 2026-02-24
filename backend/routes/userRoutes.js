// routes/userRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const User = require("../models/users");

const multer = require("multer");
const path = require("path");


/* STORAGE CONFIG */

const storage = multer.diskStorage({

  destination: function (req, file, cb) {

    cb(null, "uploads/");

  },

  filename: function (req, file, cb) {

    const uniqueName =
      req.user._id +
      "_" +
      Date.now() +
      path.extname(file.originalname);

    cb(null, uniqueName);

  }

});


const upload = multer({
  storage: storage
});


/* GET PROFILE */

router.get("/me", authenticate, async (req, res) => {

  try {

    const user = await User.findById(req.user._id)
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

});


/* UPDATE PROFILE WITH IMAGE */

router.put(
  "/me",
  authenticate,
  upload.single("photo"),   // IMPORTANT
  async (req, res) => {

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


      /* If image uploaded */
      if (req.file) {

        updateData.photoUrl =
          `/uploads/${req.file.filename}`;

      }


      const updatedUser =
        await User.findByIdAndUpdate(

          req.user._id,

          updateData,

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

  }

);




module.exports = router;