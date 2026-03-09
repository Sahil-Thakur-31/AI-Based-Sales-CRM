const mongoose = require("mongoose");
const Event = require("../models/events");
const Industry = require("../models/industries");
const Location = require("../models/location");
const Source = require("../models/sources");
const Notification = require("../models/notifications");
const Team = require("../models/teams");
const User = require("../models/users");
const Role = require("../models/roles");
const { syncSingleCrmItemToGoogle } = require("../services/googleCalendarSync");

const sanitizeObjectIdList = (values = []) => {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  values.forEach((value) => {
    const text = String(value || "").trim();
    if (mongoose.Types.ObjectId.isValid(text)) unique.add(text);
  });
  return Array.from(unique);
};

const roleName = (role) => String(role || "").trim().toLowerCase();
const isAdminOrManager = (role) => ["admin", "manager"].includes(roleName(role));
const isRestrictedUser = (role) => !isAdminOrManager(role);

const getAttendanceNotificationRecipients = async (actorUserId) => {
  const teamDocs = await Team.find({ "members.userId": actorUserId })
    .select("teamLeads.userId")
    .lean();

  const teamLeadIds = new Set(
    teamDocs.flatMap((team) => (team.teamLeads || []).map((lead) => String(lead.userId || "")))
  );

  const adminManagerRoles = await Role.find({
    is_deleted: { $ne: true },
    name: { $in: ["Admin", "Manager", "admin", "manager"] }
  })
    .select("_id")
    .lean();

  const roleIds = adminManagerRoles.map((item) => item._id).filter(Boolean);
  const adminManagerUsers = roleIds.length
    ? await User.find({
      is_deleted: { $ne: true },
      role: { $in: roleIds }
    })
      .select("_id")
      .lean()
    : [];

  const recipients = new Set([
    ...Array.from(teamLeadIds),
    ...adminManagerUsers.map((user) => String(user._id))
  ]);
  recipients.delete(String(actorUserId));

  return Array.from(recipients).filter(Boolean);
};

const populateEventQuery = (query) =>
  query
    .populate({ path: "industry", model: "industries", select: "name" })
    .populate({ path: "location", model: "location", select: "city State country zone" })
    .populate({ path: "source", model: "sources", select: "name" })
    .populate({ path: "attendedBy", model: "User", select: "name email" })
    .populate({ path: "registrations.user", model: "User", select: "name email" })
    .populate({ path: "registrations.attendeeUsers", model: "User", select: "name email" });

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

const syncEventToGoogleForAttendees = async (event, attendeesList) => {
  if (!event || !event.startDate) return;
  const syncItem = {
    id: `event-${String(event._id)}`,
    type: "event_expo",
    title: String(event.name || "Event & Expo"),
    start: new Date(event.startDate).toISOString(),
    end: event.endDate ? new Date(event.endDate).toISOString() : new Date(event.startDate).toISOString(),
    allDay: true,
    notes: String(event.description || ""),
    location: String(event.venue || event.address || ""),
    isPrompt: false,
  };

  const users = [...new Set(attendeesList.map(String).filter(Boolean))];
  for (const uid of users) {
    try {
      await syncSingleCrmItemToGoogle(syncItem, uid);
    } catch (err) {
      console.error(`events gcal sync error for user ${uid}:`, err);
    }
  }
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

const softDeleteExpiredEvents = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  await Event.updateMany(
    {
      is_deleted: false,
      endDate: { $lt: startOfToday }
    },
    {
      $set: {
        is_deleted: true,
        status: "completed"
      }
    }
  );
};

exports.getEventMeta = async (req, res) => {
  try {
    const [industries, locations, sources] = await Promise.all([
      Industry.find({ is_deleted: false }).select("_id name").sort({ name: 1 }).lean(),
      Location.aggregate([
        {
          $project: {
            _id: 1,
            city: { $trim: { input: { $ifNull: ["$city", ""] } } },
            State: {
              $trim: {
                input: {
                  $ifNull: ["$State", { $ifNull: ["$state", ""] }]
                }
              }
            },
            country: 1,
            zone: 1
          }
        },
        {
          $match: {
            city: { $ne: "" }
          }
        },
        {
          $group: {
            _id: {
              city: { $toLower: "$city" },
              State: { $toLower: "$State" }
            },
            city: { $first: "$city" },
            State: { $first: "$State" },
            country: { $first: "$country" },
            zone: { $first: "$zone" }
          }
        },
        { $sort: { city: 1 } },
        { $limit: 1500 }
      ]).allowDiskUse(true),
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
    await softDeleteExpiredEvents();

    const filter = buildListFilter(req.query, req.user?._id);
    const mineOnly =
      req.query.mine_only === "true" ||
      req.query.mine_only === true ||
      req.query.own_only === "true" ||
      req.query.own_only === true;

    if (mineOnly) {
      const ownFilter = {
        $or: [
          { "registrations.attendeeUsers": req.user?._id },
          { registeredBy: req.user?._id },
          { attendedBy: req.user?._id },
        ],
      };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, ownFilter];
        delete filter.$or;
      } else {
        Object.assign(filter, ownFilter);
      }
    } else if (isRestrictedUser(req.user?.role)) {
      filter["registrations.attendeeUsers"] = req.user?._id;
      const aiSources = await Source.find({
        is_deleted: false,
        name: { $regex: "ai", $options: "i" }
      })
        .select("_id")
        .lean();
      const aiSourceIds = aiSources.map((item) => item._id);
      filter.$and = [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $or: [
            { aiRecommendation: { $exists: false } },
            { aiRecommendation: null },
            { aiRecommendation: "" }
          ]
        },
        aiSourceIds.length
          ? { $or: [{ source: { $exists: false } }, { source: null }, { source: { $nin: aiSourceIds } }] }
          : { $or: [{ source: { $exists: false } }, { source: null }] }
      ];
    }
    const sort = { startDate: 1, createdAt: -1 };

    const events = await populateEventQuery(Event.find(filter)).sort(sort);

    res.json(events.map((item) => formatEvent(item, req.user?._id)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch events" });
  }
};

exports.getEventSummary = async (req, res) => {
  try {
    await softDeleteExpiredEvents();

    const userId = req.user?._id;
    let salesOnlyFilter = isRestrictedUser(req.user?.role)
      ? { is_deleted: false, status: "upcoming", "registrations.attendeeUsers": userId }
      : { is_deleted: false, status: "upcoming" };

    if (isRestrictedUser(req.user?.role)) {
      const aiSources = await Source.find({
        is_deleted: false,
        name: { $regex: "ai", $options: "i" }
      })
        .select("_id")
        .lean();
      const aiSourceIds = aiSources.map((item) => item._id);
      salesOnlyFilter = {
        ...salesOnlyFilter,
        $and: [
          {
            $or: [
              { aiRecommendation: { $exists: false } },
              { aiRecommendation: null },
              { aiRecommendation: "" }
            ]
          },
          aiSourceIds.length
            ? { $or: [{ source: { $exists: false } }, { source: null }, { source: { $nin: aiSourceIds } }] }
            : { $or: [{ source: { $exists: false } }, { source: null }] }
        ]
      };
    }

    const [upcomingEvents, registeredEvents, attendingEvents, avgAi, lastUpdated] = await Promise.all([
      Event.countDocuments(salesOnlyFilter),
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
    const event = await populateEventQuery(Event.findOne({
      _id: req.params.id,
      is_deleted: false
    }));

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      isRestrictedUser(req.user?.role) &&
      !event.registrations?.some((reg) =>
        (reg.attendeeUsers || []).some(
          (attUser) => String(attUser?._id || attUser) === String(req.user?._id)
        )
      )
    ) {
      return res.status(403).json({ message: "Unauthorized for this event" });
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
      industryText,
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

    if (!name || !startDate || !endDate) {
      return res.status(400).json({
        message: "name, industry and dates are required"
      });
    }

    let industryId = null;
    const typedIndustry = String(industryText || "").trim();

    if (industry && mongoose.Types.ObjectId.isValid(industry)) {
      industryId = industry;
    } else {
      const fallbackIndustryName = typedIndustry || String(industry || "").trim();
      if (!fallbackIndustryName) {
        return res.status(400).json({ message: "Industry is required" });
      }

      const escaped = fallbackIndustryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const existingIndustry = await Industry.findOne({
        name: { $regex: `^${escaped}$`, $options: "i" }
      })
        .select("_id")
        .lean();

      if (existingIndustry?._id) {
        industryId = existingIndustry._id;
      } else {
        const createdIndustry = await Industry.create({
          name: fallbackIndustryName
        });
        industryId = createdIndustry._id;
      }
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
      industry: industryId,
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

    const populated = await populateEventQuery(Event.findById(event._id));

    // Try syncing back to the creator initially, and anyone registered.
    const attendeesList = [
      String(req.user?._id),
      ...(populated.registeredBy || []),
      ...(populated.attendedBy || [])
    ];
    await syncEventToGoogleForAttendees(populated, attendeesList);

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

    const attendeesList = [
      String(req.user?._id),
      ...(event.registeredBy || []),
      ...(event.attendedBy || []),
      ...(event.registrations || []).flatMap((r) => r.attendeeUsers || [])
    ];
    await syncEventToGoogleForAttendees(event, attendeesList);

    res.json(formatEvent(event, req.user?._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update event" });
  }
};

exports.registerForEvent = async (req, res) => {
  try {
    if (!isAdminOrManager(req.user?.role)) {
      return res.status(403).json({ message: "Only admin/manager can register attendees" });
    }

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

    if (attendeeUsers.length) {
      const selectedUsers = await User.find({
        _id: { $in: attendeeUsers },
        is_deleted: { $ne: true }
      })
        .populate("role", "name")
        .select("_id role")
        .lean();

      const hasAdminAttendee = selectedUsers.some(
        (user) => String(user?.role?.name || "").trim().toLowerCase() === "admin"
      );

      if (hasAdminAttendee) {
        return res.status(400).json({ message: "Admin users cannot be selected as attendees" });
      }
    }

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

    const populated = await populateEventQuery(Event.findById(event._id));

    const allAttendeesList = [
      ...(populated.registeredBy || []),
      ...(populated.attendedBy || []),
      ...(populated.registrations || []).flatMap((r) => r.attendeeUsers || [])
    ];
    await syncEventToGoogleForAttendees(populated, allAttendeesList);

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
    const existingEvent = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    }).select("name attendedBy registrations.attendeeUsers");

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    const actorId = String(req.user._id);
    const wasAttending = (existingEvent.attendedBy || []).some(
      (id) => String(id) === actorId
    );

    if (isRestrictedUser(req.user?.role)) {
      const allowed = (existingEvent.registrations || []).some((reg) =>
        (reg.attendeeUsers || []).some((id) => String(id) === actorId)
      );
      if (!allowed) {
        return res.status(403).json({ message: "You are not assigned to this event" });
      }
    }

    const update = attending
      ? { $addToSet: { attendedBy: req.user._id } }
      : { $pull: { attendedBy: req.user._id } };

    const event = await populateEventQuery(Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      update,
      { returnDocument: "after" }
    ));

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (attending && !wasAttending) {
      const actorUser = await User.findById(req.user._id).select("name email").lean();
      const actorLabel = actorUser?.name || actorUser?.email || "A user";
      const recipientIds = await getAttendanceNotificationRecipients(req.user._id);

      if (recipientIds.length > 0) {
        await Notification.insertMany(
          recipientIds.map((userId) => ({
            userId,
            title: "Event Attendance Update",
            message: `${actorLabel} marked attending for "${existingEvent.name}".`,
            type: "info",
            relatedId: existingEvent._id,
            relatedType: "event"
          }))
        );
      }
    }

    const allAttendeesList = [
      ...(event.registeredBy || []),
      ...(event.attendedBy || []),
      ...(event.registrations || []).flatMap((r) => r.attendeeUsers || [])
    ];
    await syncEventToGoogleForAttendees(event, allAttendeesList);

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
