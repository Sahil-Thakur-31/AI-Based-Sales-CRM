const express = require("express");

const router = express.Router();

const Notification = require("../models/notifications");
const Followup = require("../models/followUp");

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

    const now = new Date();
    const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const followups = await Followup.find({
      is_deleted: false,
      assignedTo: req.user._id,
      status: { $in: ["pending", "overdue"] },
      dueDateTime: { $gte: now, $lte: twoDaysLater },
    })
      .select("title dueDateTime leadId")
      .lean();

    const leadReminderNotifications = followups
      .map((followup) => {
        const dueAt = new Date(followup.dueDateTime);
        if (Number.isNaN(dueAt.getTime())) return null;

        const diffMs = dueAt.getTime() - now.getTime();
        if (diffMs <= 0) return null;

        const diffHours = Math.ceil(diffMs / (60 * 60 * 1000));

        let reminderLabel = null;
        if (diffHours <= 6) {
          reminderLabel = `${diffHours} hour${diffHours > 1 ? "s" : ""} left`;
        } else if (diffHours <= 24) {
          reminderLabel = "1 day left";
        } else if (diffHours <= 48) {
          reminderLabel = "2 days left";
        } else {
          return null;
        }

        return {
          _id: `lead-reminder-${followup._id}-${dueAt.getTime()}`,
          userId: req.user._id,
          title: "Lead Next Action Reminder",
          message: `${followup.title || "Upcoming follow-up"} (${reminderLabel})`,
          type: diffHours <= 6 ? "warning" : "info",
          isRead: false,
          relatedId: followup.leadId || followup._id,
          relatedType: "Lead",
          createdAt: dueAt,
          updatedAt: dueAt,
        };
      })
      .filter(Boolean);

    const combined = [...leadReminderNotifications, ...notifications]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    res.json(combined);

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
