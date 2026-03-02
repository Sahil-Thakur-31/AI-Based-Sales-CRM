const mongoose = require("mongoose");
const Followup = require("../models/followUp");
const FollowupHistory = require("../models/followUpHistory");
const Meeting = require("../models/meetings");
const UserDailyActivity = require("../models/user_daily_activity");
const User = require("../models/users");
const Team = require("../models/teams");

function normalizeRole(roleName = "") {
  return String(roleName).trim().toLowerCase();
}

function isAdmin(roleName) {
  const r = normalizeRole(roleName);
  return r === "admin";
}

function isManager(roleName) {
  const r = normalizeRole(roleName);
  return r === "manager";
}

function isSales(roleName) {
  const r = normalizeRole(roleName);
  return r === "sales person" || r === "salesperson" || r === "sales";
}

async function getAccessibleUserIds(reqUser) {
  const myId = String(reqUser._id);
  let roleName = reqUser.role;

  // Resolve role from DB if JWT payload is missing/stale/non-standard.
  if (!isAdmin(roleName) && !isManager(roleName) && !isSales(roleName)) {
    const me = await User.findById(reqUser._id).populate("role", "name").select("_id role");
    roleName = me?.role?.name || roleName;
  }

  if (isSales(roleName)) return [myId];

  if (isManager(roleName)) {
    const teams = await Team.find({ "teamLead.userId": reqUser._id }).select("members.userId");
    const memberIds = teams.flatMap((t) =>
      (t.members || []).map((m) => String(m.userId)).filter(Boolean)
    );
    return [...new Set([myId, ...memberIds])];
  }

  if (isAdmin(roleName)) {
    const users = await User.find({ is_deleted: { $ne: true } }).populate("role", "name").select("_id role");
    const ids = users
      .filter((u) => {
        const rn = normalizeRole(u.role?.name || "");
        return rn === "admin" || rn === "manager" || isSales(rn);
      })
      .map((u) => String(u._id));
    return [...new Set([myId, ...ids])];
  }

  return [myId];
}

function validatePayload(body) {
  const errors = [];
  if (!body.title || !String(body.title).trim()) errors.push("title is required");
  if (!body.dueDateTime) errors.push("dueDateTime is required");
  if (body.dueDateTime && Number.isNaN(new Date(body.dueDateTime).getTime())) {
    errors.push("dueDateTime must be a valid date");
  }
  if (body.priority && !["low", "medium", "high", "urgent"].includes(body.priority)) {
    errors.push("priority must be one of low, medium, high, urgent");
  }
  if (body.kind && !["followup", "meeting"].includes(body.kind)) {
    errors.push("kind must be followup or meeting");
  }
  if (body.stage && !["P1", "P2", "P3", "P4", "P5", "P6", "P7"].includes(body.stage)) {
    errors.push("stage must be one of P1-P7");
  }
  return errors;
}

async function appendHistory({ followupId, actionType, notes, performedBy }) {
  const historyDoc = await FollowupHistory.create({
    followupId,
    actionType,
    notes,
    performedBy,
  });

  await Followup.updateOne(
    { _id: followupId },
    { $push: { followupHistory: historyDoc._id } }
  );
}

function getUtcDayRangeFromQuery(query) {
  const dateStr = String(query.date || "");
  const tzOffsetMinutes = Number(query.tzOffsetMinutes);
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const hasValidOffset = Number.isFinite(tzOffsetMinutes);

  if (hasValidDate && hasValidOffset) {
    const [year, month, day] = dateStr.split("-").map(Number);
    const startUtc = new Date(Date.UTC(year, month - 1, day) + tzOffsetMinutes * 60 * 1000);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  const now = new Date();
  const startUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { startUtc, endUtc };
}

function mapFollowupStatusToMeetingStatus(status) {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

function mapActionTypeToMeetingType(actionType = "") {
  const a = String(actionType).toLowerCase();
  if (a.includes("online")) return "online";
  return "physical";
}

function parseExactLocation(raw = "") {
  const [lat, lng] = String(raw).split(",").map((s) => s.trim());
  return {
    latitude: lat || undefined,
    longitude: lng || undefined,
  };
}

function isMeetingLikeFollowup(doc) {
  if (!doc) return false;
  if (doc.kind === "meeting") return true;
  const action = String(doc.actionType || "").toLowerCase();
  return action.includes("meeting");
}

async function syncMeetingMirrorFromFollowup(doc, actorId) {
  if (!isMeetingLikeFollowup(doc)) return;

  const { latitude, longitude } = parseExactLocation(doc.exactLocation || "");
  const now = new Date();
  const payload = {
    sourceFollowupId: doc._id,
    Id: doc._id,
    title: doc.title || "",
    description: doc.notes || "",
    clientName: doc.clientName || "",
    actionType: doc.actionType || "Meeting",
    createdBy: actorId ? new mongoose.Types.ObjectId(actorId) : doc.assignedTo,
    assignedTo: doc.assignedTo,
    meetingType: mapActionTypeToMeetingType(doc.actionType),
    meetingDate: doc.dueDateTime,
    startTime: doc.dueDateTime,
    durationMinutes: doc.durationMinutes || undefined,
    Address: doc.address || "",
    status: mapFollowupStatusToMeetingStatus(doc.status),
    latitude,
    longitude,
    followupRequired: true,
    followupDate: doc.dueDateTime,
    agenda_of_meating: doc.agenda || "",
    priority: doc.priority || "medium",
    is_deleted: doc.is_deleted === true,
    updatedAt: now,
  };

  await Meeting.findOneAndUpdate(
    { sourceFollowupId: doc._id },
    { $set: payload, $setOnInsert: { createdAt: now } },
    { upsert: true, new: true }
  );
}

async function softDeleteMeetingMirror(followupId) {
  await Meeting.updateOne(
    { sourceFollowupId: followupId },
    { $set: { is_deleted: true, status: "cancelled", updatedAt: new Date() } }
  );
}

async function logUserDailyActivity({
  userId,
  activityId,
  activityStatus,
  title,
  description,
}) {
  if (!userId || !activityId) return;

  const now = new Date();
  await UserDailyActivity.create({
    userId: new mongoose.Types.ObjectId(userId),
    activityType: "followup",
    activityId: new mongoose.Types.ObjectId(activityId),
    activityStatus: activityStatus || "pending",
    title: title || "",
    description: description || "",
    createdAt: now,
    updatedAt: now,
    is_deleted: false,
  });
}

exports.list = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const q = {
      is_deleted: { $ne: true },
      assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };

    if (req.query.kind) q.kind = req.query.kind;
    if (req.query.status) q.status = req.query.status;
    if (req.query.stage) q.stage = req.query.stage;

    if (req.query.today === "true") {
      const { startUtc, endUtc } = getUtcDayRangeFromQuery(req.query);
      q.dueDateTime = { $gte: startUtc, $lt: endUtc };
    }

    const docs = await Followup.find(q).sort({ dueDateTime: 1, createdAt: -1 }).populate("assignedTo", "name email");
    res.json(docs);
  } catch (err) {
    console.error("followups.list error:", err);
    res.status(500).json({ message: "Failed to fetch followups" });
  }
};

exports.listTodayMeetings = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const { startUtc, endUtc } = getUtcDayRangeFromQuery(req.query);
    const assignedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));

    const q = {
      is_deleted: { $ne: true },
      sourceFollowupId: { $exists: true },
      assignedTo: { $in: assignedObjectIds },
      startTime: { $gte: startUtc, $lt: endUtc },
      status: { $in: ["pending", "scheduled", "rescheduled"] },
    };

    const fallbackMeetings = await Followup.find({
      is_deleted: { $ne: true },
      status: { $in: ["pending", "overdue"] },
      assignedTo: { $in: assignedObjectIds },
      dueDateTime: { $gte: startUtc, $lt: endUtc },
    });

    const meetingLikeFallback = fallbackMeetings.filter(isMeetingLikeFollowup);

    if (meetingLikeFallback.length > 0) {
      await Promise.all(meetingLikeFallback.map((m) => syncMeetingMirrorFromFollowup(m, req.user._id)));
    }

    const docs = await Meeting.find(q).sort({ startTime: 1, createdAt: -1 });
    res.json(docs);
  } catch (err) {
    console.error("followups.listTodayMeetings error:", err);
    res.status(500).json({ message: "Failed to fetch today's meetings" });
  }
};

exports.filterOptions = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const allowedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find({
      _id: { $in: allowedObjectIds },
      is_deleted: { $ne: true },
    }).populate("role", "name").select("_id name email role");

    const userMap = new Map(
      users.map((u) => [
        String(u._id),
        {
          id: String(u._id),
          name: u.name || "Unknown",
          email: u.email || "",
          role: normalizeRole(u.role?.name || ""),
        },
      ])
    );

    const teams = await Team.find({}).select("_id teamLead members");
    const visibleTeams = teams
      .map((t) => {
        const leadId = String(t.teamLead?.userId || "");
        const memberIds = (t.members || []).map((m) => String(m.userId)).filter(Boolean);
        const userIds = [...new Set([leadId, ...memberIds].filter((id) => userMap.has(id)))];
        if (userIds.length === 0) return null;

        return {
          id: String(t._id),
          leadUserId: leadId,
          memberUserIds: memberIds.filter((id) => userMap.has(id)),
          userIds,
          label: `Team ${userMap.get(leadId)?.name || "Unknown"}`,
        };
      })
      .filter(Boolean);

    const employees = users.map((u) => ({
      id: String(u._id),
      name: u.name || "Unknown",
      email: u.email || "",
      role: normalizeRole(u.role?.name || ""),
    }));

    res.json({
      teams: visibleTeams,
      employees,
    });
  } catch (err) {
    console.error("followups.filterOptions error:", err);
    res.status(500).json({ message: "Failed to fetch filter options" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const doc = await Followup.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true },
      assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).populate("assignedTo", "name email");

    if (!doc) return res.status(404).json({ message: "Followup not found" });
    res.json(doc);
  } catch (err) {
    console.error("followups.getOne error:", err);
    res.status(500).json({ message: "Failed to fetch followup" });
  }
};

exports.create = async (req, res) => {
  try {
    const errors = validatePayload(req.body);
    if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

    const allowedIds = await getAccessibleUserIds(req.user);
    const assignedToRaw = req.body.assignedTo || req.user._id;
    const assignedTo = String(assignedToRaw);

    if (!allowedIds.includes(assignedTo)) {
      return res.status(403).json({ message: "You cannot assign followup to this user" });
    }

    const payload = {
      kind: req.body.kind || "followup",
      actionType: req.body.actionType || "",
      title: String(req.body.title).trim(),
      clientName: req.body.clientName || "",
      stage: req.body.stage || "P1",
      notes: req.body.notes || "",
      priority: req.body.priority || "medium",
      status: req.body.status || "pending",
      dueDateTime: new Date(req.body.dueDateTime),
      assignedTo: new mongoose.Types.ObjectId(assignedTo),
      durationMinutes: req.body.durationMinutes || undefined,
      agenda: req.body.agenda || "",
      address: req.body.address || "",
      exactLocation: req.body.exactLocation || "",
    };

    const doc = await Followup.create(payload);
    await syncMeetingMirrorFromFollowup(doc, req.user._id);

    await appendHistory({
      followupId: doc._id,
      actionType: "created",
      notes: `Created ${payload.kind}`,
      performedBy: req.user._id,
    });

    const created = await Followup.findById(doc._id).populate("assignedTo", "name email");
    try {
      await logUserDailyActivity({
        userId: req.user._id,
        activityId: doc._id,
        activityStatus: payload.status,
        title: payload.title,
        description: `Created ${payload.kind}`,
      });
    } catch (activityErr) {
      console.error("followups.create activity log error:", activityErr);
    }
    res.status(201).json(created);
  } catch (err) {
    console.error("followups.create error:", err);
    res.status(500).json({ message: "Failed to create followup" });
  }
};

exports.update = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const current = await Followup.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true },
      assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });

    if (!current) return res.status(404).json({ message: "Followup not found" });

    const nextAssignedRaw = req.body.assignedTo || current.assignedTo;
    const nextAssigned = String(nextAssignedRaw);
    if (!allowedIds.includes(nextAssigned)) {
      return res.status(403).json({ message: "You cannot assign followup to this user" });
    }

    const merged = {
      kind: req.body.kind ?? current.kind,
      actionType: req.body.actionType ?? current.actionType,
      title: req.body.title ?? current.title,
      clientName: req.body.clientName ?? current.clientName,
      stage: req.body.stage ?? current.stage,
      notes: req.body.notes ?? current.notes,
      priority: req.body.priority ?? current.priority,
      status: req.body.status ?? current.status,
      dueDateTime: req.body.dueDateTime ? new Date(req.body.dueDateTime) : current.dueDateTime,
      assignedTo: new mongoose.Types.ObjectId(nextAssigned),
      durationMinutes: req.body.durationMinutes ?? current.durationMinutes,
      agenda: req.body.agenda ?? current.agenda,
      address: req.body.address ?? current.address,
      exactLocation: req.body.exactLocation ?? current.exactLocation,
    };

    const errors = validatePayload(merged);
    if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

    await Followup.updateOne({ _id: current._id }, { $set: merged });
    const updatedDoc = await Followup.findById(current._id);
    await syncMeetingMirrorFromFollowup(updatedDoc, req.user._id);

    await appendHistory({
      followupId: current._id,
      actionType: "details_updated",
      notes: `Updated ${merged.kind} details`,
      performedBy: req.user._id,
    });

    const updated = await Followup.findById(current._id).populate("assignedTo", "name email");
    try {
      await logUserDailyActivity({
        userId: req.user._id,
        activityId: current._id,
        activityStatus: merged.status,
        title: merged.title,
        description: `Updated ${merged.kind} details`,
      });
    } catch (activityErr) {
      console.error("followups.update activity log error:", activityErr);
    }
    res.json(updated);
  } catch (err) {
    console.error("followups.update error:", err);
    res.status(500).json({ message: "Failed to update followup" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "completed", "overdue", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const allowedIds = await getAccessibleUserIds(req.user);
    const updated = await Followup.findOneAndUpdate(
      {
        _id: req.params.id,
        is_deleted: { $ne: true },
        assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
      },
      {
        status,
        completedAt: status === "completed" ? new Date() : null,
      },
      { new: true }
    ).populate("assignedTo", "name email");

    if (!updated) return res.status(404).json({ message: "Followup not found" });
    await syncMeetingMirrorFromFollowup(updated, req.user._id);

    await appendHistory({
      followupId: updated._id,
      actionType: "status_changed",
      notes: `Status changed to ${status}`,
      performedBy: req.user._id,
    });

    try {
      await logUserDailyActivity({
        userId: req.user._id,
        activityId: updated._id,
        activityStatus: updated.status,
        title: updated.title,
        description: `Changed status to ${status}`,
      });
    } catch (activityErr) {
      console.error("followups.updateStatus activity log error:", activityErr);
    }

    res.json(updated);
  } catch (err) {
    console.error("followups.updateStatus error:", err);
    res.status(500).json({ message: "Failed to update status" });
  }
};

exports.remove = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const existing = await Followup.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true },
      assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });

    if (!existing) return res.status(404).json({ message: "Followup not found" });

    const updated = await Followup.findOneAndUpdate(
      {
        _id: existing._id,
      },
      { is_deleted: true },
      { new: true }
    );

    if (existing.kind === "meeting") {
      await softDeleteMeetingMirror(existing._id);
    }

    try {
      await logUserDailyActivity({
        userId: req.user._id,
        activityId: existing._id,
        activityStatus: "cancelled",
        title: existing.title,
        description: `Deleted ${existing.kind}`,
      });
    } catch (activityErr) {
      console.error("followups.remove activity log error:", activityErr);
    }

    res.json({ message: "Followup deleted" });
  } catch (err) {
    console.error("followups.remove error:", err);
    res.status(500).json({ message: "Failed to delete followup" });
  }
};
