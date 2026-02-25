const express = require("express");

const router = express.Router();

const Notification = require("../models/notifications");

const authenticate = require("../middlewares/auth");


/*
GET ALL NOTIFICATIONS FOR LOGGED IN USER
*/
router.get("/", authenticate, async (req, res) => {

  try {

    const notifications = await Notification.find({

      userId: req.user._id

    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch notifications"
    });

  }

});


/*
MARK AS READ
*/
router.put("/:id/read", authenticate, async (req, res) => {

  try {

    await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true }
    );

    res.json({
      success: true
    });

  }
  catch {

    res.status(500).json({
      message: "Failed"
    });

  }

});


/*
CREATE NOTIFICATION (for system use)
*/
router.post("/", authenticate, async (req, res) => {

  try {

    const notification =
      await Notification.create({

        userId: req.user._id,

        title: req.body.title,

        message: req.body.message,

        type: req.body.type || "info"

      });

    res.json(notification);

  }
  catch {

    res.status(500).json({
      message: "Failed"
    });

  }

});


module.exports = router;