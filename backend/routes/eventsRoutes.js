const router = require("express").Router();
const auth = require("../middlewares/auth");
const paymentScreenshotUpload = require("../config/paymentScreenshotMulter");
const {
  getEventMeta,
  getEvents,
  getEventSummary,
  getEventById,
  createEvent,
  updateEvent,
  registerForEvent,
  getMyEventRegistration,
  acceptEventInvitation,
  toggleAttending,
  markEventMissed,
  saveEventOutcome,
  softDeleteEvent
} = require("../controllers/eventsController");

router.get("/meta", auth, getEventMeta);
router.get("/summary", auth, getEventSummary);
router.get("/", auth, getEvents);
router.get("/:id/my-registration", auth, getMyEventRegistration);
router.get("/:id", auth, getEventById);
router.post("/", auth, createEvent);
router.put("/:id", auth, updateEvent);
router.put("/:id/register", auth, paymentScreenshotUpload.single("paymentScreenshot"), registerForEvent);
router.put("/:id/accept-invitation", auth, acceptEventInvitation);
router.put("/:id/attending", auth, toggleAttending);
router.put("/:id/missed", auth, markEventMissed);
router.put("/:id/outcome", auth, saveEventOutcome);
router.put("/delete/:id", auth, softDeleteEvent);

module.exports = router;
