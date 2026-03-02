const router = require("express").Router();
const auth = require("../middlewares/auth");
const {
  getEventMeta,
  getEvents,
  getEventSummary,
  getEventById,
  createEvent,
  updateEvent,
  registerForEvent,
  getMyEventRegistration,
  toggleAttending,
  softDeleteEvent
} = require("../controllers/eventsController");

router.get("/meta", auth, getEventMeta);
router.get("/summary", auth, getEventSummary);
router.get("/", auth, getEvents);
router.get("/:id/my-registration", auth, getMyEventRegistration);
router.get("/:id", auth, getEventById);
router.post("/", auth, createEvent);
router.put("/:id", auth, updateEvent);
router.put("/:id/register", auth, registerForEvent);
router.put("/:id/attending", auth, toggleAttending);
router.put("/delete/:id", auth, softDeleteEvent);

module.exports = router;
