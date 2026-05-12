const mongoose = require("mongoose");
const Event = require("../models/events");
const Industry = require("../models/industries");
const Location = require("../models/location");
const Source = require("../models/sources");
const EventScraperRun = require("../models/eventScraperRuns");
const Notification = require("../models/notifications");
const Team = require("../models/teams");
const User = require("../models/users");
const Role = require("../models/roles");
const { syncSingleCrmItemToGoogle } = require("../services/googleCalendarSync");
const REGISTRATION_GRACE_DAYS = 4;

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
const normalizeDedupText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ");

const normalizeDedupDate = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const addDays = (dateValue, days) => {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
};

const getEventEndDate = (event = {}) => {
  const eventEnd = event.endDate ? new Date(event.endDate) : (event.startDate ? new Date(event.startDate) : null);
  if (!eventEnd || Number.isNaN(eventEnd.getTime())) return null;
  return eventEnd;
};

const toStartOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const isValidHttpUrl = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const eventApiDedupKey = (eventDoc) => {
  const signature = normalizeDedupText(eventDoc?.dedupeSignature);
  if (signature) return `signature:${signature}`;

  const externalIdentityKey = normalizeDedupText(eventDoc?.externalIdentityKey);
  if (externalIdentityKey) return `external:${externalIdentityKey}`;

  const normalizedWebsiteUrl = normalizeDedupText(eventDoc?.normalizedWebsiteUrl || eventDoc?.websiteUrl);
  if (normalizedWebsiteUrl) return `url:${normalizedWebsiteUrl}`;

  const sourceKey = normalizeDedupText(eventDoc?.source?.name || eventDoc?.source);
  const nameKey = normalizeDedupText(eventDoc?.name);
  const dayKey = normalizeDedupDate(eventDoc?.startDate);
  const cityKey = normalizeDedupText(eventDoc?.location?.city);
  const stateKey = normalizeDedupText(eventDoc?.location?.State || eventDoc?.location?.state);
  const venueKey = normalizeDedupText(eventDoc?.venue || eventDoc?.address);
  const locationKey = cityKey || stateKey ? `${cityKey || "na"}|${stateKey || "na"}` : (venueKey || "na");

  return `fallback:${sourceKey}|${nameKey}|${dayKey}|${locationKey}`;
};

const eventApiWinnerScore = (eventDoc) => {
  const aiScore = Number(eventDoc?.aiRelevanceScore || 0);
  const hasRoleComparison = eventDoc?.roiRoleComparison ? 1 : 0;
  const hasPredictedRoi = Number.isFinite(Number(eventDoc?.predictedROI)) ? 1 : 0;
  const registrationCount = Array.isArray(eventDoc?.registrations) ? eventDoc.registrations.length : 0;
  const attendedCount = Array.isArray(eventDoc?.attendedBy) ? eventDoc.attendedBy.length : 0;
  const interestedCount = Array.isArray(eventDoc?.interested) ? eventDoc.interested.length : 0;
  const updatedAt = eventDoc?.updatedAt ? new Date(eventDoc.updatedAt).getTime() : 0;
  return (
    (hasRoleComparison * 8000000000000) +
    (hasPredictedRoi * 4000000000000) +
    (aiScore * 1000) +
    (registrationCount * 100) +
    (attendedCount * 50) +
    (interestedCount * 20) +
    updatedAt
  );
};

const dedupeEventList = (events = []) => {
  const byKey = new Map();
  events.forEach((eventDoc) => {
    const key = eventApiDedupKey(eventDoc);
    const existing = byKey.get(key);
    if (!existing || eventApiWinnerScore(eventDoc) >= eventApiWinnerScore(existing)) {
      byKey.set(key, eventDoc);
    }
  });
  return Array.from(byKey.values());
};

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
    .populate({ path: "missedBy", model: "User", select: "name email" })
    .populate({ path: "attendedBy", model: "User", select: "name email" })
    .populate({ path: "registrations.eventManagerUser", model: "User", select: "name email" })
    .populate({ path: "registrations.user", model: "User", select: "name email" })
    .populate({ path: "registrations.attendeeUsers", model: "User", select: "name email" });

const textDeclaresFreeEventFee = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  return [
    /\bfree entry\b/i,
    /\bfree event\b/i,
    /\bfree registration\b/i,
    /\bno registration fee\b/i,
    /\bentry free\b/i,
    /\bthis meetup is free\b/i,
    /\bthis event is free\b/i,
    /\bfree to attend\b/i,
    /\bfree\s+to\s+(?:attend|join|register)\b/i,
    /\bfee\s*[:\-]?\s*(?:free|0|zero)\b/i,
    /\b(?:registration|ticket|pass)\s+(?:is\s+)?free\b/i,
    /\bcomplimentary\s+(?:entry|registration|pass|ticket)\b/i,
  ].some((pattern) => pattern.test(text));
};

const normalizeEventRegistrationFeeForDisplay = (event = {}) => {
  if (textDeclaresFreeEventFee(`${event.name || ""} ${event.description || ""}`)) {
    return 0;
  }

  const sourceName = String(event.source?.name || event.source || "").trim().toLowerCase();
  const currency = String(event.registrationCurrency || "INR").trim().toUpperCase();
  const fee = Number(event.registrationFee);
  if (sourceName === "meetup" && (!currency || currency === "INR") && Number.isFinite(fee) && fee <= 5) {
    return 0;
  }

  return event.registrationFee;
};

const formatEvent = (eventDoc, userId) => {
  const event = eventDoc.toObject ? eventDoc.toObject() : eventDoc;
  const currentUserId = String(userId || "");
  const registrationRows = Array.isArray(event.registrations) ? event.registrations : [];
  const isMissed = Boolean(
    (event.missedAt && !Number.isNaN(new Date(event.missedAt).getTime())) ||
    String(event.missedReason || "").trim() ||
    event.missedBy
  );

  const isRegisteredInLegacy = event.registeredBy?.some(
    (id) => String(id?._id || id) === currentUserId
  );
  const isRegisteredInRegistration = registrationRows.some(
    (registration) =>
      String(registration?.user?._id || registration?.user) === currentUserId ||
      (Array.isArray(registration?.attendeeUsers) &&
        registration.attendeeUsers.some((entry) => String(entry?._id || entry) === currentUserId))
  );
  const isAttendingInLegacy = event.attendedBy?.some(
    (id) => String(id?._id || id) === currentUserId
  );
  const myRegistration =
    registrationRows.find(
      (registration) =>
        String(registration?.user?._id || registration?.user) === currentUserId ||
        (Array.isArray(registration?.attendeeUsers) &&
          registration.attendeeUsers.some((entry) => String(entry?._id || entry) === currentUserId))
    ) ||
    null;
  const fallbackRegistration = registrationRows[0] || null;
  const registrationWebsiteUrl = String(myRegistration?.websiteUrl || fallbackRegistration?.websiteUrl || "").trim();

  return {
    ...event,
    registrationFee: normalizeEventRegistrationFeeForDisplay(event),
    isRegistered: Boolean(isRegisteredInLegacy || isRegisteredInRegistration),
    isAttending: Boolean(isAttendingInLegacy),
    isMissed,
    myRegistration,
    registrationWebsiteUrl,
    registrationLocked: Array.isArray(event.attendedBy) && event.attendedBy.length > 0,
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
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      {
        $or: [
          { registeredBy: userId },
          { "registrations.user": userId },
        ]
      }
    ];
  }

  if (query.attending === "true") {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      {
        $or: [
          { attendedBy: userId },
        ]
      }
    ];
  }

  return filter;
};

const buildOwnEventFilter = (userId) => ({
  $or: [
    { "registrations.attendeeUsers": userId },
    { "registrations.user": userId },
    { registeredBy: userId },
    { attendedBy: userId },
  ],
});

const toOptionalNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, parsed);
};

const isEventMarkedMissed = (event = {}) =>
  Boolean(
    (event.missedAt && !Number.isNaN(new Date(event.missedAt).getTime())) ||
    String(event.missedReason || "").trim() ||
    event.missedBy
  );

const deriveEventEngagementLabel = (event = {}, startOfToday = null) => {
  const attendedCount = Array.isArray(event.attendedBy) ? event.attendedBy.length : 0;
  const registeredCount =
    (Array.isArray(event.registeredBy) ? event.registeredBy.length : 0) +
    (Array.isArray(event.registrations) ? event.registrations.length : 0);
  if (attendedCount > 0) return "positive";
  if (isEventMarkedMissed(event)) return "negative";

  const boundary = startOfToday || (() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  })();
  const graceExpiryBoundary = addDays(boundary, -REGISTRATION_GRACE_DAYS);
  const prepReadyDate = new Date(boundary);
  prepReadyDate.setDate(prepReadyDate.getDate() + 3);
  const eventStart = event.startDate ? new Date(event.startDate) : null;
  const eventEnd = getEventEndDate(event);
  const isPast = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < boundary);
  if (registeredCount > 0) {
    if (eventEnd && eventEnd < graceExpiryBoundary) return "negative";
    return "positive";
  }
  const isNearTerm =
    Boolean(eventStart && !Number.isNaN(eventStart.getTime()) && eventStart >= boundary && eventStart < prepReadyDate);
  if (isNearTerm) return "negative";
  return isPast ? "negative" : "neutral";
};

const EVENT_TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "your", "our", "this", "that",
  "event", "events", "expo", "conference", "summit", "workshop", "meetup", "online",
  "india", "in", "on", "at"
]);

const tokenizeEventText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !EVENT_TOKEN_STOPWORDS.has(token));

const buildEventFeatureTokens = (event = {}) => {
  const locationState = event.location?.State || event.location?.state || "";
  const chunks = [
    event.name,
    event.description,
    event.venue,
    event.address,
    event.industry?.name || event.industryName || "",
    event.location?.city || "",
    locationState,
    event.source?.name || "",
  ];

  const seen = new Set();
  const tokens = [];
  chunks.flatMap((chunk) => tokenizeEventText(chunk)).forEach((token) => {
    if (seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  });
  return tokens;
};

const softDeleteExpiredEvents = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  await Event.updateMany(
    {
      is_deleted: false,
      endDate: { $lt: startOfToday },
      status: { $ne: "completed" },
    },
    {
      $set: {
        status: "completed",
        updatedAt: new Date(),
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
    const currentUserId = req.user?._id;
    const ownEventFilter = buildOwnEventFilter(currentUserId);
    const mineOnly =
      req.query.mine_only === "true" ||
      req.query.mine_only === true ||
      req.query.own_only === "true" ||
      req.query.own_only === true;

    if (mineOnly) {
      if (filter.$or) {
        filter.$and = [
          ...(Array.isArray(filter.$and) ? filter.$and : []),
          { $or: filter.$or },
          ownEventFilter,
        ];
        delete filter.$or;
      } else {
        filter.$and = [
          ...(Array.isArray(filter.$and) ? filter.$and : []),
          ownEventFilter,
        ];
      }
    } else if (isRestrictedUser(req.user?.role)) {
      if (filter.$or) {
        filter.$and = [
          ...(Array.isArray(filter.$and) ? filter.$and : []),
          { $or: filter.$or },
          ownEventFilter,
        ];
        delete filter.$or;
      } else {
        filter.$and = [
          ...(Array.isArray(filter.$and) ? filter.$and : []),
          ownEventFilter,
        ];
      }
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
    const dedupedEvents = dedupeEventList(events);

    res.json(dedupedEvents.map((item) => formatEvent(item, req.user?._id)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch events" });
  }
};

exports.getEventSummary = async (req, res) => {
  try {
    await softDeleteExpiredEvents();

    const userId = req.user?._id;
    const restrictedMode = isRestrictedUser(req.user?.role);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const prepReadyDate = new Date(startOfToday);
    prepReadyDate.setDate(prepReadyDate.getDate() + 3);
    const registrationGraceBoundary = addDays(startOfToday, -REGISTRATION_GRACE_DAYS);
    const baseVisibilityFilter = restrictedMode
      ? { is_deleted: false, ...buildOwnEventFilter(userId) }
      : { is_deleted: false };

    if (restrictedMode) {
      const aiSources = await Source.find({
        is_deleted: false,
        name: { $regex: "ai", $options: "i" }
      })
        .select("_id")
        .lean();
      const aiSourceIds = aiSources.map((item) => item._id);
      baseVisibilityFilter.$and = [
        ...(Array.isArray(baseVisibilityFilter.$and) ? baseVisibilityFilter.$and : []),
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

    const upcomingDateCondition = {
      $or: [
        { startDate: { $gte: prepReadyDate } },
        { startDate: null, endDate: { $gte: prepReadyDate } },
      ],
    };
    const noAnyRegistrationCondition = {
      $nor: [
        { "registeredBy.0": { $exists: true } },
        { "registrations.0": { $exists: true } },
      ]
    };
    const noAnyAttendanceCondition = {
      $nor: [
        { "attendedBy.0": { $exists: true } },
      ]
    };
    const registrationCondition = restrictedMode
      ? {
        $or: [
          { registeredBy: userId },
          { "registrations.user": userId },
          { "registrations.attendeeUsers": userId },
        ],
      }
      : {
        $or: [
          { "registeredBy.0": { $exists: true } },
          { "registrations.0": { $exists: true } },
        ],
      };
    const attendanceCondition = restrictedMode
      ? { attendedBy: userId }
      : { "attendedBy.0": { $exists: true } };
    const explicitMissedCondition = {
      $or: [
        { missedAt: { $ne: null } },
        { missedReason: { $nin: ["", null] } },
      ],
    };
    const noAttendanceCondition = {
      $nor: [attendanceCondition]
    };
    const activeRegisteredWindowCondition = {
      $or: [
        { endDate: { $gte: registrationGraceBoundary } },
        { endDate: null, startDate: { $gte: registrationGraceBoundary } },
      ],
    };
    const missedWindowCondition = {
      $or: [
        { endDate: { $lt: registrationGraceBoundary } },
        { endDate: null, startDate: { $lt: registrationGraceBoundary } },
      ],
    };
    const upcomingFilter = restrictedMode
      ? {
        ...baseVisibilityFilter,
        status: { $ne: "completed" },
        ...upcomingDateCondition,
      }
      : {
        ...baseVisibilityFilter,
        status: { $ne: "completed" },
        ...upcomingDateCondition,
        $and: [
          noAnyRegistrationCondition,
          noAnyAttendanceCondition,
        ],
      };
    const pastFilter = {
      ...baseVisibilityFilter,
      $or: [
        { endDate: { $lt: startOfToday } },
        { endDate: null, startDate: { $lt: startOfToday } },
      ],
    };
    const registeredFilter = {
      ...baseVisibilityFilter,
      $and: [
        registrationCondition,
        { $nor: [explicitMissedCondition] },
        noAttendanceCondition,
        activeRegisteredWindowCondition,
      ],
    };
    const attendingFilter = {
      ...baseVisibilityFilter,
      ...attendanceCondition,
    };
    const missedPastFilter = {
      ...baseVisibilityFilter,
      $and: [
        registrationCondition,
        noAttendanceCondition,
        {
          $or: [
            explicitMissedCondition,
            missedWindowCondition,
          ]
        },
      ],
    };

    const uninterestedPastFilter = {
      ...pastFilter,
      $and: [
        {
          $nor: [
            { "registeredBy.0": { $exists: true } },
            { "registrations.0": { $exists: true } },
            { "attendedBy.0": { $exists: true } },
          ]
        },
      ],
    };

    const startOfTomorrow = addDays(startOfToday, 1);
    const todayFetchedFilter = {
      ...baseVisibilityFilter,
      createdAt: { $gte: startOfToday, $lt: startOfTomorrow },
    };

    const [upcomingEvents, registeredEvents, attendingEvents, missedPastEvents, uninterestedPastEvents, avgAi, lastUpdated, todayFetchedCount, lastScraperRun] = await Promise.all([
      Event.countDocuments(upcomingFilter),
      Event.countDocuments(registeredFilter),
      Event.countDocuments(attendingFilter),
      Event.countDocuments(missedPastFilter),
      Event.countDocuments(uninterestedPastFilter),
      Event.aggregate([
        { $match: { ...baseVisibilityFilter, aiRelevanceScore: { $ne: null } } },
        { $group: { _id: null, avgScore: { $avg: "$aiRelevanceScore" } } }
      ]),
      Event.findOne(baseVisibilityFilter).sort({ updatedAt: -1 }).select("updatedAt").lean(),
      Event.countDocuments(todayFetchedFilter),
      EventScraperRun.findOne({
        finishedAt: { $ne: null },
      })
        .sort({ finishedAt: -1 })
        .select("finishedAt syncResult")
        .lean(),
    ]);

    res.json({
      upcomingEvents,
      registeredEvents,
      attendingEvents,
      missedPastEvents,
      uninterestedPastEvents,
      avgAiScore: Number(avgAi?.[0]?.avgScore || 0),
      lastUpdatedAt: lastUpdated?.updatedAt || null,
      todayFetchedCount,
      lastScraperRunAt: lastScraperRun?.finishedAt || null,
      lastScraperNewEvents: Number(lastScraperRun?.syncResult?.importedCount || 0),
      lastScraperUpdatedEvents: Number(lastScraperRun?.syncResult?.updatedCount || 0),
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
        .select("_id name")
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
    const industryDoc = industryId ? await Industry.findById(industryId).select("name").lean() : null;

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
      registrationFee: toOptionalNonNegativeNumber(registrationFee),
      attendeesCount: toOptionalNonNegativeNumber(attendeesCount),
      exhibitorsCount: toOptionalNonNegativeNumber(exhibitorsCount),
      aiRelevanceScore: aiRelevanceScore == null || aiRelevanceScore === "" ? undefined : Number(aiRelevanceScore),
      ruleEngineScore: aiRelevanceScore == null || aiRelevanceScore === "" ? null : Number(aiRelevanceScore),
      blendedAiScore: aiRelevanceScore == null || aiRelevanceScore === "" ? null : Number(aiRelevanceScore),
      aiRecommendation,
      featureTokens: buildEventFeatureTokens({
        name,
        description,
        venue,
        address,
        industryName: industryDoc?.name || typedIndustry || "",
      }),
      source: source && mongoose.Types.ObjectId.isValid(source) ? source : undefined,
      expectedROIRange,
      priorityTag: priorityTag || "medium",
      status: status || "upcoming",
      websiteUrl: "",
      normalizedWebsiteUrl: "",
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

    if (Object.prototype.hasOwnProperty.call(updates, "registrationFee")) {
      updates.registrationFee = toOptionalNonNegativeNumber(updates.registrationFee);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "attendeesCount")) {
      updates.attendeesCount = toOptionalNonNegativeNumber(updates.attendeesCount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "exhibitorsCount")) {
      updates.exhibitorsCount = toOptionalNonNegativeNumber(updates.exhibitorsCount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "websiteUrl")) {
      delete updates.websiteUrl;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "normalizedWebsiteUrl")) {
      delete updates.normalizedWebsiteUrl;
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

    const featureTokens = buildEventFeatureTokens(event);
    const engagementLabel = deriveEventEngagementLabel(event);
    const aiScore = toOptionalNonNegativeNumber(event.aiRelevanceScore);
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          featureTokens,
          engagementLabel,
          ruleEngineScore: event.ruleEngineScore ?? aiScore,
          blendedAiScore: event.blendedAiScore ?? aiScore,
          updatedAt: new Date(),
        },
      }
    );
    event.featureTokens = featureTokens;
    event.engagementLabel = engagementLabel;

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
    if (Array.isArray(event.attendedBy) && event.attendedBy.length > 0) {
      return res.status(400).json({ message: "Registration details are locked after attendance is marked." });
    }

    const eventManagerUserId = sanitizeObjectIdList([req.body?.eventManagerUserId])[0] || "";
    const participationRole = String(req.body?.participationRole || "").trim();
    const websiteUrl = String(req.body?.websiteUrl || "").trim();
    const attendeesCountRaw = Number(req.body?.attendeesCount || 1);
    const attendeesCount = Number.isFinite(attendeesCountRaw) ? Math.max(1, Math.min(50, Math.round(attendeesCountRaw))) : 1;
    let parsedAttendees = [];
    try {
      parsedAttendees = JSON.parse(req.body?.attendeeUsers || "[]");
    } catch {
      return res.status(400).json({ message: "Attendee users payload is invalid." });
    }
    const attendeeUsers = sanitizeObjectIdList(parsedAttendees);
    const isPaymentRequiredRaw = String(req.body?.isPaymentRequired ?? "true").trim().toLowerCase();
    const isPaymentRequired = !["false", "0", "no", "off"].includes(isPaymentRequiredRaw);
    const paymentMethod = String(req.body?.paymentMethod || "").trim();
    const paymentReferenceNo = String(req.body?.paymentReferenceNo || "").trim();
    const amountPaid = toOptionalNonNegativeNumber(req.body?.amountPaid);
    const paymentDate = req.body?.paymentDate ? new Date(req.body.paymentDate) : null;
    const paymentNotes = String(req.body?.paymentNotes || "").trim();
    const currentUserId = String(req.user._id);
    const regIndex = event.registrations.findIndex((reg) => String(reg.user) === currentUserId);
    const existingRegistration = regIndex >= 0 ? event.registrations[regIndex] : null;
    const existingScreenshotPath = String(existingRegistration?.payment?.screenshotPath || "").trim();
    const screenshotPath = String(req.file?.path || existingScreenshotPath || "").trim();

    if (!eventManagerUserId) {
      return res.status(400).json({ message: "Event manager is required." });
    }
    const managerUser = await User.findOne({
      _id: eventManagerUserId,
      is_deleted: { $ne: true }
    })
      .populate("role", "name")
      .select("_id role")
      .lean();
    const managerRoleName = roleName(managerUser?.role?.name || "");
    if (!managerUser?._id || managerRoleName !== "manager") {
      return res.status(400).json({ message: "Selected event manager must be a manager user." });
    }
    if (!participationRole) {
      return res.status(400).json({ message: "Participation role is required." });
    }
    if (!isValidHttpUrl(websiteUrl)) {
      return res.status(400).json({ message: "A valid event website URL is required while registering." });
    }
    if (attendeeUsers.length !== attendeesCount) {
      return res.status(400).json({ message: "Attendees count must match the selected attendee users." });
    }
    if (attendeeUsers.some((id) => String(id) === String(eventManagerUserId))) {
      return res.status(400).json({ message: "The selected event manager cannot also be chosen as an attendee." });
    }
    if (
      isPaymentRequired &&
      (!paymentMethod || !paymentReferenceNo || amountPaid === null || !paymentDate || Number.isNaN(paymentDate.getTime()) || !screenshotPath)
    ) {
      return res.status(400).json({ message: "Complete payment details including screenshot are required." });
    }

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
      if (selectedUsers.length !== attendeeUsers.length) {
        return res.status(400).json({ message: "One or more selected attendees are invalid." });
      }
    }

    if (!event.registeredBy.some((id) => String(id) === currentUserId)) {
      event.registeredBy.push(req.user._id);
    }

    const previousAttendeeUsers = regIndex >= 0
      ? sanitizeObjectIdList(event.registrations[regIndex]?.attendeeUsers || [])
      : [];
    const registrationPayload = {
      user: req.user._id,
      eventManagerUser: eventManagerUserId,
      participationRole,
      websiteUrl,
      attendeesCount,
      specialRequirements: req.body?.specialRequirements || "",
      isPaymentRequired,
      attendeeUsers,
      payment: isPaymentRequired
        ? {
          method: paymentMethod,
          referenceNo: paymentReferenceNo,
          amountPaid: amountPaid ?? 0,
          paymentDate,
          screenshotPath,
          notes: paymentNotes
        }
        : {
          method: "",
          referenceNo: "",
          amountPaid: 0,
          paymentDate: null,
          screenshotPath: "",
          notes: ""
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
    event.missedReason = "";
    event.missedAt = null;
    event.missedBy = null;
    event.engagementLabel = "positive";

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
      (reg) =>
        String(reg.user) === String(req.user._id) ||
        (Array.isArray(reg.attendeeUsers) && reg.attendeeUsers.some((entry) => String(entry) === String(req.user._id)))
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
    }).select("name attendedBy registrations.attendeeUsers endDate startDate missedReason missedAt");

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (!attending) {
      return res.status(400).json({ message: "Attended status cannot be reversed once marked." });
    }

    const actorId = String(req.user._id);
    const wasAttending = (existingEvent.attendedBy || []).some(
      (id) => String(id) === actorId
    );
    if (wasAttending) {
      return res.status(400).json({ message: "You have already marked this event as attended. This cannot be reversed." });
    }
    if (isEventMarkedMissed(existingEvent)) {
      return res.status(400).json({ message: "This event is already marked as missed. Attended cannot be marked now." });
    }

    if (isRestrictedUser(req.user?.role)) {
      const allowed = (existingEvent.registrations || []).some((reg) =>
        (reg.attendeeUsers || []).some((id) => String(id) === actorId)
      );
      if (!allowed) {
        return res.status(403).json({ message: "You are not assigned to this event" });
      }
    }
    const startOfToday = toStartOfDay(new Date());
    const eventEnd = getEventEndDate(existingEvent);
    if (!eventEnd || eventEnd >= startOfToday) {
      return res.status(400).json({ message: "Attended can only be marked after the event end date." });
    }

    const update = {
      $addToSet: { attendedBy: req.user._id },
      $set: {
        missedReason: "",
        missedAt: null,
        missedBy: null,
      },
    };

    const event = await populateEventQuery(Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      update,
      { returnDocument: "after" }
    ));

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const updatedLabel = deriveEventEngagementLabel(event);
    if (String(event.engagementLabel || "") !== updatedLabel) {
      await Event.updateOne(
        { _id: event._id },
        { $set: { engagementLabel: updatedLabel, updatedAt: new Date() } }
      );
      event.engagementLabel = updatedLabel;
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

exports.markEventMissed = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Missed reason is required." });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    }).select("name attendedBy registeredBy registrations endDate startDate missedReason missedAt");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (Array.isArray(event.attendedBy) && event.attendedBy.length > 0) {
      return res.status(400).json({ message: "Attended event cannot be marked as missed." });
    }

    const hasAnyRegistration =
      (Array.isArray(event.registeredBy) && event.registeredBy.length > 0) ||
      (Array.isArray(event.registrations) && event.registrations.length > 0);
    if (!hasAnyRegistration) {
      return res.status(400).json({ message: "Only registered events can be marked as missed." });
    }

    const actorId = String(req.user._id);
    if (isRestrictedUser(req.user?.role)) {
      const allowed = (event.registrations || []).some((reg) =>
        (reg.attendeeUsers || []).some((id) => String(id) === actorId)
      );
      if (!allowed) {
        return res.status(403).json({ message: "You are not assigned to this event" });
      }
    }

    const startOfToday = toStartOfDay(new Date());
    const eventEnd = getEventEndDate(event);
    if (!eventEnd || eventEnd >= startOfToday) {
      return res.status(400).json({ message: "Missed can only be marked after the event end date." });
    }

    const updated = await populateEventQuery(Event.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      {
        $set: {
          missedReason: reason,
          missedAt: new Date(),
          missedBy: req.user._id,
          engagementLabel: "negative",
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    ));

    if (!updated) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.json(formatEvent(updated, req.user?._id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to mark event as missed" });
  }
};

exports.saveEventOutcome = async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      is_deleted: false
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const actorId = String(req.user?._id || "");
    if (isRestrictedUser(req.user?.role)) {
      const assigned = (event.registrations || []).some((reg) =>
        (reg.attendeeUsers || []).some((attendeeId) => String(attendeeId) === actorId)
      );
      if (!assigned) {
        return res.status(403).json({ message: "You are not assigned to this event" });
      }
    }

    if (!Array.isArray(event.attendedBy) || event.attendedBy.length === 0) {
      return res.status(400).json({ message: "Outcome can be saved only for attended events." });
    }

    const generatedRevenue = toOptionalNonNegativeNumber(req.body?.generatedRevenue);
    const investmentCost = toOptionalNonNegativeNumber(req.body?.investmentCost);
    const collectedLeads = toOptionalNonNegativeNumber(req.body?.collectedLeads);
    const qualifiedLeads = toOptionalNonNegativeNumber(req.body?.qualifiedLeads);
    const dealsClosed = toOptionalNonNegativeNumber(req.body?.dealsClosed);
    const notes = String(req.body?.notes || "").trim();
    if (
      generatedRevenue === null &&
      investmentCost === null &&
      collectedLeads === null &&
      qualifiedLeads === null &&
      dealsClosed === null &&
      !notes
    ) {
      return res.status(400).json({ message: "Provide at least one outcome field to save." });
    }

    const finalRevenue = generatedRevenue !== null
      ? generatedRevenue
      : toOptionalNonNegativeNumber(event.realizedRevenue);
    const finalCost = investmentCost !== null
      ? investmentCost
      : (toOptionalNonNegativeNumber(event.realizedCost) ?? toOptionalNonNegativeNumber(event.registrationFee) ?? 0);
    const realizedROI = (finalRevenue !== null && finalCost > 0)
      ? Number(((finalRevenue - finalCost) / finalCost).toFixed(4))
      : null;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const updatedLabel = deriveEventEngagementLabel(event, startOfToday);

    const updated = await Event.findOneAndUpdate(
      { _id: event._id, is_deleted: false },
      {
        $set: {
          realizedRevenue: finalRevenue,
          realizedCost: finalCost,
          realizedROI,
          realizedCollectedLeads: collectedLeads !== null ? collectedLeads : toOptionalNonNegativeNumber(event.realizedCollectedLeads),
          realizedQualifiedLeads: qualifiedLeads !== null ? qualifiedLeads : toOptionalNonNegativeNumber(event.realizedQualifiedLeads),
          realizedDealsClosed: dealsClosed !== null ? dealsClosed : toOptionalNonNegativeNumber(event.realizedDealsClosed),
          realizedNotes: notes || String(event.realizedNotes || ""),
          roiModelSource: realizedROI === null ? (event.roiModelSource || "manual_outcome") : "realized_outcome",
          engagementLabel: updatedLabel,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    )
      .populate({ path: "industry", model: "industries", select: "name" })
      .populate({ path: "location", model: "location", select: "city State country zone" })
      .populate({ path: "source", model: "sources", select: "name" })
      .populate({ path: "attendedBy", model: "User", select: "name email" })
      .populate({ path: "registrations.eventManagerUser", model: "User", select: "name email" })
      .populate({ path: "registrations.user", model: "User", select: "name email" })
      .populate({ path: "registrations.attendeeUsers", model: "User", select: "name email" });

    return res.json(formatEvent(updated, req.user?._id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to save event outcome" });
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
