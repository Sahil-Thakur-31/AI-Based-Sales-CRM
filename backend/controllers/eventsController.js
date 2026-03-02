const mongoose = require("mongoose");
const Event = require("../models/events");
const Industry = require("../models/industries");
const Location = require("../models/location");
const Source = require("../models/sources");
const Notification = require("../models/notifications");

const sanitizeObjectIdList = (values = []) => {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  values.forEach((value) => {
    const text = String(value || "").trim();
    if (mongoose.Types.ObjectId.isValid(text)) unique.add(text);
  });
  return Array.from(unique);
};

const formatEvent = (eventDoc, userId) => {
  const event = eventDoc.toObject ? eventDoc.toObject() : eventDoc;
  const currentUserId = String(userId || "");

  const isRegistered = event.registeredBy?.some(
    (id) => String(id?._id || id) === currentUserId
  );
  const isAttending = event.attendedBy?.some(
    (id) => String(id?._id || id) === currentUserId
  );

  return {
    ...event,
    isRegistered: Boolean(isRegistered),
    isAttending: Boolean(isAttending)
  };
};

const buildListFilter = (query, userId) => {
  const filter = { is_deleted: false };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.priorityTag) {
    filter.priorityTag = query.priorityTag;
  }

  if (query.industry && mongoose.Types.ObjectId.isValid(query.industry)) {
    filter.industry = query.industry;
  }

  if (query.search?.trim()) {
    const text = query.search.trim();
    filter.$or = [
      { name: { $regex: text, $options: "i" } },
      { venue: { $regex: text, $options: "i" } },
      { address: { $regex: text, $options: "i" } },
      { description: { $regex: text, $options: "i" } }
    ];
  }

  if (query.registered === "true") {
    filter.registeredBy = userId;
  }

  if (query.attending === "true") {
    filter.attendedBy = userId;
  }

  return filter;
};

exports.getEventMeta = async (req, res) => {
  try {
    const [industries, locations, sources] = await Promise.all([
      Industry.find({ is_deleted: false }).select("_id name").sort({ name: 1 }).lean(),
      Location.find({}).select("_id city State country zone").sort({ city: 1 }).lean(),
      Source.find({ is_deleted: false }).select("_id name").sort({ name: 1 }).lean()
    ]);

    res.json({ industries, locations, sources });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch event metadata" });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const filter = buildListFilter(req.query, req.user?._id);
    const sort = { startDate: 1, createdAt: -1 };

    const events = await Event.find(filter)
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" })
      .populate({ path: "source", model: "sources", select: "name" })
      .sort(sort);

    res.json(events.map((item) => formatEvent(item, req.user?._id)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch events" });
  }
};

exports.getEventSummary = async (req, res) => {
  try {
    const userId = req.user?._id;
    const [upcomingEvents, registeredEvents, attendingEvents, avgAi, lastUpdated] = await Promise.all([
      Event.countDocuments({ is_deleted: false, status: "upcoming" }),
      Event.countDocuments({ is_deleted: false, registeredBy: userId }),
      Event.countDocuments({ is_deleted: false, attendedBy: userId }),
      Event.aggregate([
        { $match: { is_deleted: false, aiRelevanceScore: { $ne: null } } },
        { $group: { _id: null, avgScore: { $avg: "$aiRelevanceScore" } } }
      ]),
      Event.findOne({ is_deleted: false }).sort({ updatedAt: -1 }).select("updatedAt").lean()
    ]);

    res.json({
      upcomingEvents,
      registeredEvents,
      attendingEvents,
      avgAiScore: Number(avgAi?.[0]?.avgScore || 0),
      lastUpdatedAt: lastUpdated?.updatedAt || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch event summary" });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    })
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" })
      .populate({ path: "source", model: "sources", select: "name" });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json(formatEvent(event, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch event" });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const {
      name,
      industry,
      venue,
      address,
      location,
      locationText,
      stateText,
      startDate,
      endDate,
      registrationFee,
      attendeesCount,
      exhibitorsCount,
      aiRelevanceScore,
      aiRecommendation,
      source,
      expectedROIRange,
      priorityTag,
      status,
      websiteUrl,
      description
    } = req.body;

    if (!name || !industry || !startDate || !endDate) {
      return res.status(400).json({
        message: "name, industry, startDate and endDate are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(industry)) {
      return res.status(400).json({ message: "Invalid industry" });
    }

    let locationId = null;
    if (location && mongoose.Types.ObjectId.isValid(location)) {
      locationId = location;
    } else if (locationText?.trim()) {
      const locationQuery = {
        city: { $regex: `^${locationText.trim()}$`, $options: "i" }
      };
      if (stateText?.trim()) {
        locationQuery.State = { $regex: `^${stateText.trim()}$`, $options: "i" };
      }

      const foundLocation = await Location.findOne(locationQuery)
        .select("_id")
        .lean();
      locationId = foundLocation?._id || null;
    }

    const event = await Event.create({
      name,
      industry,
      venue,
      address,
      location: locationId,
      startDate,
      endDate,
      registrationFee: Number(registrationFee || 0),
      attendeesCount: Number(attendeesCount || 0),
      exhibitorsCount: Number(exhibitorsCount || 0),
      aiRelevanceScore: aiRelevanceScore == null || aiRelevanceScore === "" ? undefined : Number(aiRelevanceScore),
      aiRecommendation,
      source: source && mongoose.Types.ObjectId.isValid(source) ? source : undefined,
      expectedROIRange,
      priorityTag: priorityTag || "medium",
      status: status || "upcoming",
      websiteUrl,
      description
    });

    const populated = await Event.findById(event._id)
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" })
      .populate({ path: "source", model: "sources", select: "name" });

    res.status(201).json(formatEvent(populated, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create event" });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const updates = { ...req.body };

    if (updates.industry && !mongoose.Types.ObjectId.isValid(updates.industry)) {
      return res.status(400).json({ message: "Invalid industry" });
    }

    if (updates.location && !mongoose.Types.ObjectId.isValid(updates.location)) {
      delete updates.location;
    }

    if (updates.startDate && updates.endDate && new Date(updates.endDate) < new Date(updates.startDate)) {
      return res.status(400).json({ message: "End date must be after start date" });
    }

    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      updates,
      { returnDocument: "after", runValidators: true }
    )
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" })
      .populate({ path: "source", model: "sources", select: "name" });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json(formatEvent(event, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update event" });
  }
};

exports.registerForEvent = async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const { registrationData = {} } = req.body || {};
    const attendeesCount = Number(req.body?.attendeesCount || registrationData.attendeesCount || 1);
    const attendeeUsers = sanitizeObjectIdList(registrationData.attendeeUsers);
    const payment = registrationData.payment || {};
    const amountPaid = Number(payment.amountPaid || 0);
    const currentUserId = String(req.user._id);

    if (!event.registeredBy.some((id) => String(id) === currentUserId)) {
      event.registeredBy.push(req.user._id);
    }

    const regIndex = event.registrations.findIndex((reg) => String(reg.user) === currentUserId);
    const previousAttendeeUsers = regIndex >= 0
      ? sanitizeObjectIdList(event.registrations[regIndex]?.attendeeUsers || [])
      : [];
    const registrationPayload = {
      user: req.user._id,
      fullName: registrationData.fullName || "",
      email: registrationData.email || "",
      mobile: registrationData.mobile || "",
      companyName: registrationData.companyName || "",
      designation: registrationData.designation || "",
      ticketType: registrationData.ticketType || "",
      city: registrationData.city || "",
      attendeesCount: Number.isFinite(attendeesCount) && attendeesCount > 0 ? attendeesCount : 1,
      specialRequirements: registrationData.specialRequirements || "",
      attendeeUsers,
      payment: {
        method: payment.method || "",
        referenceNo: payment.referenceNo || "",
        amountPaid: Number.isFinite(amountPaid) ? amountPaid : 0,
        paymentDate: payment.paymentDate || null,
        notes: payment.notes || ""
      }
    };

    if (regIndex >= 0) {
      event.registrations[regIndex] = {
        ...event.registrations[regIndex].toObject(),
        ...registrationPayload
      };
    } else {
      event.registrations.push(registrationPayload);
    }

    if (!event.attendedBy.some((id) => String(id) === currentUserId)) {
      event.attendedBy.push(req.user._id);
    }
    attendeeUsers.forEach((id) => {
      if (!event.attendedBy.some((existing) => String(existing) === id)) {
        event.attendedBy.push(id);
      }
    });

    await event.save();

    // Notify only newly added attendee users for this event registration
    const previousSet = new Set(previousAttendeeUsers.map(String));
    const newAttendeeUsers = attendeeUsers.filter((id) => !previousSet.has(String(id)));
    if (newAttendeeUsers.length) {
      await Notification.insertMany(
        newAttendeeUsers.map((userId) => ({
          userId,
          title: "Event Invitation",
          message: `You have been added as an attendee for "${event.name}".`,
          type: "info",
          relatedId: event._id,
          relatedType: "event"
        }))
      );
    }

    const populated = await Event.findById(event._id)
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" });

    res.json(formatEvent(populated, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to register for event" });
  }
};

exports.getMyEventRegistration = async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    }).select("name registrations");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const registration = event.registrations.find(
      (reg) => String(reg.user) === String(req.user._id)
    );

    if (!registration) {
      return res.status(404).json({ message: "No registration found for this user" });
    }

    res.json({
      eventId: event._id,
      eventName: event.name,
      registration
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch registration details" });
  }
};

exports.toggleAttending = async (req, res) => {
  try {
    const attending = req.body?.attending !== false;
    const update = attending
      ? { $addToSet: { attendedBy: req.user._id } }
      : { $pull: { attendedBy: req.user._id } };

    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      update,
      { returnDocument: "after" }
    )
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json(formatEvent(event, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update attending status" });
  }
};

exports.softDeleteEvent = async (req, res) => {
  try {
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { is_deleted: true },
      { returnDocument: "after" }
    );

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete event" });
  }
};
