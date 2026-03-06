const mongoose = require("mongoose");
const Followup = require("../models/followUp");
const FollowupHistory = require("../models/followUpHistory");
const Meeting = require("../models/meetings");
const Notification = require("../models/notifications");
const UserDailyActivity = require("../models/user_daily_activity");
const User = require("../models/users");
const Team = require("../models/teams");
const CRMSettings = require("../models/crmSettings");
const { syncSingleMeetingToGoogle, deleteSingleMeetingFromGoogle } = require("../services/googleCalendarSync");

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
    const teams = await Team.find({ "teamLeads.userId": reqUser._id }).select("members.userId");
    const memberIds = teams.flatMap((t) =>
      (t.members || []).map((m) => String(m.userId)).filter(Boolean)
    );
    return [...new Set([myId, ...memberIds])];
  }

  if (isAdmin(roleName)) {
    // Admin can access all active users for assignment/filtering.
    const users = await User.find({ is_deleted: { $ne: true } }).select("_id");
    const ids = users.map((u) => String(u._id));
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
  if (body.reminderChoice && !["yes", "no", "maybe"].includes(String(body.reminderChoice).toLowerCase())) {
    errors.push("reminderChoice must be yes, no, or maybe");
  }
  if (body.reminderOptions !== undefined) {
    if (!Array.isArray(body.reminderOptions)) {
      errors.push("reminderOptions must be an array");
    } else {
      for (const opt of body.reminderOptions) {
        const unit = String(opt?.unit || "").toLowerCase();
        const value = Number(opt?.value);
        const channel = String(opt?.channel || "notification").toLowerCase();
        if (channel !== "notification") errors.push("reminderOptions.channel must be notification");
        if (!["minutes", "hours", "days"].includes(unit)) errors.push("reminderOptions.unit must be minutes, hours, or days");
        if (!Number.isFinite(value) || value < 1) errors.push("reminderOptions.value must be a positive number");
      }
    }
  }
  if (body.stage && !["P1", "P2", "P3", "P4", "P5", "P6", "P7"].includes(body.stage)) {
    errors.push("stage must be one of P1-P7");
  }
  return errors;
}

function normalizeReminderOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => {
      const unit = String(opt?.unit || "").toLowerCase();
      const value = Number(opt?.value);
      if (!["minutes", "hours", "days"].includes(unit)) return null;
      if (!Number.isFinite(value) || value < 1) return null;
      return {
        channel: "notification",
        value: Math.max(1, Math.floor(value)),
        unit,
      };
    })
    .filter(Boolean);
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

  const meetingLocation = doc.meetingLocation || doc.address || "";
  const meetingExactLocation = doc.meetingExactLocation || doc.exactLocation || "";
  const { latitude, longitude } = parseExactLocation(meetingExactLocation);
  const now = new Date();
  const payload = {
    sourceFollowupId: doc._id,
    Id: doc._id,
    title: doc.title || "",
    description: doc.notes || "",
    cancelReason: doc.cancelReason || "",
    clientName: doc.clientName || "",
    leadId: doc.leadId || undefined,
    dealId: doc.dealId || undefined,
    clientId: doc.clientId || undefined,
    stage: doc.stage || "",
    actionType: doc.actionType || "Meeting",
    createdBy: actorId ? new mongoose.Types.ObjectId(actorId) : doc.assignedTo,
    assignedTo: doc.assignedTo,
    meetingType: mapActionTypeToMeetingType(doc.actionType),
    meetingDate: doc.dueDateTime,
    startTime: doc.dueDateTime,
    durationMinutes: doc.durationMinutes || undefined,
    Address: meetingLocation,
    status: mapFollowupStatusToMeetingStatus(doc.status),
    latitude,
    longitude,
    followupRequired: true,
    followupDate: doc.dueDateTime,
    minutes_of_meeting: doc.notes || "",
    agenda_of_meating: doc.agenda || "",
    priority: doc.priority || "medium",
    is_deleted: doc.is_deleted === true,
    updatedAt: now,
  };

  await Meeting.findOneAndUpdate(
    { sourceFollowupId: doc._id },
    { $set: payload, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: "after" }
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

function getReminderOffsetMinutes(settings) {
  if (!settings) return 30;

  if (settings.reminderTiming === "15min") return 15;
  if (settings.reminderTiming === "30min") return 30;
  if (settings.reminderTiming === "1hr") return 60;
  if (settings.reminderTiming === "custom") {
    const customMinutes = Number(settings.customReminderOffsetMinutes);
    if (Number.isFinite(customMinutes) && customMinutes >= 0) {
      return customMinutes;
    }
  }

  return 30;
}

function formatReminderLabel(offsetMinutes) {
  if (offsetMinutes < 60) return `${offsetMinutes} minutes`;
  if (offsetMinutes % 60 === 0) return `${offsetMinutes / 60} hour${offsetMinutes === 60 ? "" : "s"}`;
  return `${offsetMinutes} minutes`;
}

function getNotificationItemType(doc) {
  const actionType = String(doc?.actionType || "").trim();
  if (actionType) return actionType;
  return doc?.kind === "meeting" ? "Meeting" : "Follow-up Call";
}

function getNotificationCompanyName(doc) {
  return String(doc?.clientName || "").trim() || "the selected company";
}

async function createFollowupAssignmentNotification(doc) {
  if (!doc?._id) return;

  const assignedToId = String(doc?.assignedTo?._id || doc?.assignedTo || "").trim();
  if (!assignedToId || !mongoose.Types.ObjectId.isValid(assignedToId)) return;

  const dueAt = new Date(doc?.dueDateTime);
  const dueText = Number.isNaN(dueAt.getTime()) ? "the selected time" : dueAt.toLocaleString("en-IN");
  const companyName = getNotificationCompanyName(doc);
  const itemType = doc?.kind === "meeting" ? "Meeting" : "Follow-up";

  await Notification.create({
    userId: new mongoose.Types.ObjectId(assignedToId),
    title: `${itemType} Assigned`,
    message: `${itemType} for ${companyName} is assigned to you on ${dueText}.`,
    type: "info",
    relatedId: doc._id,
    relatedType: "Followup",
  });
}

async function createFollowupNotification(doc, userId, eventType) {
  if (!doc || !userId) return;
  if (doc.reminderEnabled === false && eventType === "created") return;
  const settings = await CRMSettings.findOne({ userId }).lean();
  if (!settings?.smartFollowupRemindersEnabled || !settings?.reminderMethodInApp) return;

  const isMeeting = doc.kind === "meeting";
  const itemLabel = isMeeting ? "Meeting" : "Follow-up";
  const companyName = getNotificationCompanyName(doc);
  const itemType = getNotificationItemType(doc);

  if (eventType === "created") {
    const offsetMinutes = getReminderOffsetMinutes(settings);
    const dueAt = new Date(doc.dueDateTime);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) return;
    const scheduledText = Number.isNaN(dueAt.getTime()) ? "" : dueAt.toLocaleString("en-IN");

    await Notification.create({
      userId,
      title: `${itemLabel} Created`,
      message: `${itemType} scheduled for ${companyName} on ${scheduledText}. An in-app reminder will be shown ${formatReminderLabel(offsetMinutes)} before the scheduled time.`,
      type: "info",
      relatedId: doc._id,
      relatedType: "Followup",
    });
    return;
  }

  if (eventType === "completed") {
    await Notification.create({
      userId,
      title: `${itemLabel} Completed`,
      message: `${itemType} for ${companyName} has been marked as completed successfully.`,
      type: "success",
      relatedId: doc._id,
      relatedType: "Followup",
    });
  }
}

async function createFollowupAssignmentNotification(doc) {
  if (!doc || !doc.assignedTo) return;
  const userId = String(doc.assignedTo._id || doc.assignedTo);
  if (!userId) return;

  const settings = await CRMSettings.findOne({ userId }).lean();
  if (!settings?.smartFollowupRemindersEnabled || !settings?.reminderMethodInApp) return;

  const isMeeting = doc.kind === "meeting";
  const itemLabel = isMeeting ? "Meeting" : "Follow-up";
  const companyName = getNotificationCompanyName(doc);
  const itemType = getNotificationItemType(doc);
  const dueAt = doc.dueDateTime ? new Date(doc.dueDateTime).toLocaleString("en-IN") : "";

  await Notification.create({
    userId,
    title: `${itemLabel} Assigned to You`,
    message: `${itemType} for ${companyName} has been assigned to you${dueAt ? ` — due ${dueAt}` : ""}.`,
    type: "info",
    relatedId: doc._id,
    relatedType: "Followup",
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

    if (req.query.kind === "meeting") {
      await Promise.all(
        docs
          .filter(isMeetingLikeFollowup)
          .map(async (doc) => {
            try {
              await syncMeetingMirrorFromFollowup(doc, req.user._id);
            } catch (syncErr) {
              console.error("followups.list syncMeetingMirror error:", syncErr);
            }
          })
      );
    }

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

    const teams = await Team.find({}).select("_id name teamLeads members");
    const visibleTeams = teams
      .map((t) => {
        const leadIds = (t.teamLeads || []).map((lead) => String(lead.userId || "")).filter(Boolean);
        const memberIds = (t.members || []).map((m) => String(m.userId)).filter(Boolean);
        const userIds = [...new Set([...leadIds, ...memberIds].filter((id) => userMap.has(id)))];
        if (userIds.length === 0) return null;

        return {
          id: String(t._id),
          leadUserIds: leadIds.filter((id) => userMap.has(id)),
          memberUserIds: memberIds.filter((id) => userMap.has(id)),
          userIds,
          label: t.name || `Team ${leadIds.map((id) => userMap.get(id)?.name || "").filter(Boolean).join(", ") || "Unknown"}`,
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
      currentUser: {
        id: String(req.user._id),
      },
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
      leadId: req.body.leadId || undefined,
      dealId: req.body.dealId || undefined,
      clientId: req.body.clientId || undefined,
      clientName: req.body.clientName || "",
      stage: req.body.stage || "P1",
      notes: req.body.notes || "",
      cancelReason: req.body.cancelReason || "",
      priority: req.body.priority || "medium",
      status: req.body.status || "pending",
      dueDateTime: new Date(req.body.dueDateTime),
      reminderEnabled: req.body.reminderEnabled !== false,
      reminderChoice: String(req.body.reminderChoice || (req.body.reminderEnabled === false ? "no" : "yes")).toLowerCase(),
      reminderOptions: normalizeReminderOptions(req.body.reminderOptions || []),
      assignedTo: new mongoose.Types.ObjectId(assignedTo),
      durationMinutes: req.body.durationMinutes || undefined,
      agenda: req.body.agenda || "",
      currentLocation: req.body.currentLocation || "",
      currentExactLocation: req.body.currentExactLocation || "",
      meetingLocation: req.body.meetingLocation || req.body.address || "",
      meetingExactLocation: req.body.meetingExactLocation || req.body.exactLocation || "",
      address: req.body.meetingLocation || req.body.address || "",
      exactLocation: req.body.meetingExactLocation || req.body.exactLocation || "",
    };

    const doc = await Followup.create(payload);

    await appendHistory({
      followupId: doc._id,
      actionType: "created",
      notes: `Created ${payload.kind}`,
      performedBy: req.user._id,
    });

    try {
      await syncMeetingMirrorFromFollowup(doc, req.user._id);
    } catch (syncErr) {
      console.error("followups.create syncMeetingMirror error:", syncErr);
    }

    const created = await Followup.findById(doc._id).populate("assignedTo", "name email");
    try {
      await createFollowupAssignmentNotification(doc);
    } catch (notifErr) {
      console.error("followups.create notification error:", notifErr);
    }
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

    try {
      await createFollowupNotification(doc, req.user._id, "created");
    } catch (notificationErr) {
      console.error("followups.create notification error:", notificationErr);
    }

    if (isMeetingLikeFollowup(created)) {
      try {
        // Sync only newly created meetings to Google Calendar.
        await syncSingleMeetingToGoogle(created, created.assignedTo._id || created.assignedTo);
      } catch (gcalErr) {
        console.error("followups.create gcal sync error:", gcalErr);
      }
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
      leadId: req.body.leadId ?? current.leadId,
      dealId: req.body.dealId ?? current.dealId,
      clientId: req.body.clientId ?? current.clientId,
      clientName: req.body.clientName ?? current.clientName,
      stage: req.body.stage ?? current.stage,
      notes: req.body.notes ?? current.notes,
      cancelReason: req.body.cancelReason ?? current.cancelReason,
      priority: req.body.priority ?? current.priority,
      status: req.body.status ?? current.status,
      dueDateTime: req.body.dueDateTime ? new Date(req.body.dueDateTime) : current.dueDateTime,
      reminderEnabled: req.body.reminderEnabled ?? current.reminderEnabled,
      reminderChoice:
        req.body.reminderChoice !== undefined
          ? String(req.body.reminderChoice).toLowerCase()
          : current.reminderChoice || (current.reminderEnabled === false ? "no" : "yes"),
      reminderOptions:
        req.body.reminderOptions !== undefined
          ? normalizeReminderOptions(req.body.reminderOptions)
          : current.reminderOptions || [],
      assignedTo: new mongoose.Types.ObjectId(nextAssigned),
      durationMinutes: req.body.durationMinutes ?? current.durationMinutes,
      agenda: req.body.agenda ?? current.agenda,
      currentLocation: req.body.currentLocation ?? current.currentLocation,
      currentExactLocation: req.body.currentExactLocation ?? current.currentExactLocation,
      meetingLocation: req.body.meetingLocation ?? req.body.address ?? current.meetingLocation ?? current.address,
      meetingExactLocation: req.body.meetingExactLocation ?? req.body.exactLocation ?? current.meetingExactLocation ?? current.exactLocation,
      address: req.body.meetingLocation ?? req.body.address ?? current.meetingLocation ?? current.address,
      exactLocation: req.body.meetingExactLocation ?? req.body.exactLocation ?? current.meetingExactLocation ?? current.exactLocation,
    };

    const errors = validatePayload(merged);
    if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

    await Followup.updateOne({ _id: current._id }, { $set: merged });
    const updatedDoc = await Followup.findById(current._id);

    await appendHistory({
      followupId: current._id,
      actionType: "details_updated",
      notes: `Updated ${merged.kind} details`,
      performedBy: req.user._id,
    });

    try {
      await syncMeetingMirrorFromFollowup(updatedDoc, req.user._id);
    } catch (syncErr) {
      console.error("followups.update syncMeetingMirror error:", syncErr);
    }

    const updated = await Followup.findById(current._id).populate("assignedTo", "name email");

    const oldAssignee = String(current.assignedTo || "");
    const newAssignee = String(merged.assignedTo || "");
    const dueDateChanged =
      new Date(current.dueDateTime || 0).getTime() !== new Date(merged.dueDateTime || 0).getTime();
    if (newAssignee && (newAssignee !== oldAssignee || dueDateChanged)) {
      try {
        await createFollowupAssignmentNotification(updated || { ...merged, _id: current._id });
      } catch (notifErr) {
        console.error("followups.update notification error:", notifErr);
      }
    }

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

    if (isMeetingLikeFollowup(updated)) {
      try {
        const assigneeId = updated.assignedTo?._id || updated.assignedTo;
        if (String(updated.status || "").toLowerCase() === "cancelled") {
          await deleteSingleMeetingFromGoogle(updated, assigneeId);
        } else {
          // Sync only updated meetings to Google Calendar.
          await syncSingleMeetingToGoogle(updated, assigneeId);
        }
      } catch (gcalErr) {
        console.error("followups.update gcal sync error:", gcalErr);
      }
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

    const updatePayload = {
      status,
      completedAt: status === "completed" ? new Date() : null,
    };

    if (req.body.durationMinutes !== undefined && req.body.durationMinutes !== "") {
      const durationMinutes = Number(req.body.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
        return res.status(400).json({ message: "durationMinutes must be a positive number" });
      }
      updatePayload.durationMinutes = durationMinutes;
    }

    if (req.body.notes !== undefined) {
      updatePayload.notes = String(req.body.notes || "").trim();
    }

    if (status === "cancelled") {
      const cancelReasonRaw = req.body.cancelReason ?? req.body.notes ?? "";
      const cancelReason = String(cancelReasonRaw).trim();
      if (!cancelReason) {
        return res.status(400).json({ message: "Cancellation reason is required" });
      }
      updatePayload.cancelReason = cancelReason;
      if (req.body.notes === undefined) {
        updatePayload.notes = cancelReason;
      }
    } else if (req.body.cancelReason !== undefined) {
      updatePayload.cancelReason = String(req.body.cancelReason || "").trim();
    }

    const allowedIds = await getAccessibleUserIds(req.user);
    const updated = await Followup.findOneAndUpdate(
      {
        _id: req.params.id,
        is_deleted: { $ne: true },
        assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
      },
      {
        $set: updatePayload,
      },
      { returnDocument: "after" }
    ).populate("assignedTo", "name email");

    if (!updated) return res.status(404).json({ message: "Followup not found" });

    await appendHistory({
      followupId: updated._id,
      actionType: "status_changed",
      notes:
        status === "completed"
          ? `Status changed to completed${updated.durationMinutes ? ` | Duration: ${updated.durationMinutes} min` : ""}${updated.notes ? ` | MOM: ${updated.notes}` : ""}`
          : status === "cancelled"
            ? `Status changed to cancelled${updated.cancelReason ? ` | Reason: ${updated.cancelReason}` : ""}`
          : `Status changed to ${status}`,
      performedBy: req.user._id,
    });

    try {
      await syncMeetingMirrorFromFollowup(updated, req.user._id);
    } catch (syncErr) {
      console.error("followups.updateStatus syncMeetingMirror error:", syncErr);
    }

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

    if (status === "completed") {
      try {
        await createFollowupNotification(updated, req.user._id, "completed");
      } catch (notificationErr) {
        console.error("followups.updateStatus notification error:", notificationErr);
      }
    }

    if (isMeetingLikeFollowup(updated)) {
      try {
        const assigneeId = updated.assignedTo?._id || updated.assignedTo;
        if (status === "cancelled") {
          await deleteSingleMeetingFromGoogle(updated, assigneeId);
        } else {
          await syncSingleMeetingToGoogle(updated, assigneeId);
        }
      } catch (gcalErr) {
        console.error("followups.updateStatus gcal sync error:", gcalErr);
      }
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
      { returnDocument: "after" }
    );

    if (existing.kind === "meeting") {
      await softDeleteMeetingMirror(existing._id);
    }

    if (isMeetingLikeFollowup(existing)) {
      try {
        await deleteSingleMeetingFromGoogle(existing, existing.assignedTo);
      } catch (gcalErr) {
        console.error("followups.remove gcal delete error:", gcalErr);
      }
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
