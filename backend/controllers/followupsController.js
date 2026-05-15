const mongoose = require("mongoose");
const Followup = require("../models/followUp");
const FollowupHistory = require("../models/followUpHistory");
const Meeting = require("../models/meetings");
const Lead = require("../models/leads");
const Deal = require("../models/deals");
const LeadContacts = require("../models/leadContacts");
const ClientContact = require("../models/client_contact");
const Notification = require("../models/notifications");
const UserDailyActivity = require("../models/user_daily_activity");
const User = require("../models/users");
const Team = require("../models/teams");
const CRMSettings = require("../models/crmSettings");
const { TEMPLATE_KEYS } = require("../services/emailTemplates");
const { syncSingleMeetingToGoogle, deleteSingleMeetingFromGoogle } = require("../services/googleCalendarSync");
const { refreshPrioritiesForFollowupAndMeeting } = require("../services/followupPriorityAiService");

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

async function resolveRequesterRoleName(reqUser) {
  let roleName = reqUser?.role;
  if (isAdmin(roleName) || isManager(roleName) || isSales(roleName)) {
    return String(roleName || "");
  }
  const me = await User.findById(reqUser?._id).populate("role", "name").select("role").lean();
  return String(me?.role?.name || roleName || "");
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

const VALID_STAGE_KEYS = new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);

function normalizeStageValue(stage) {
  const value = String(stage || "").trim().toUpperCase();
  return VALID_STAGE_KEYS.has(value) ? value : "";
}

async function resolveStageFromLinkedEntity({ leadId, dealId, fallbackStage = "P1" }) {
  const normalizedFallback = normalizeStageValue(fallbackStage) || "P1";

  if (dealId && mongoose.Types.ObjectId.isValid(String(dealId))) {
    const deal = await Deal.findById(dealId).select("stage").lean();
    const dealStage = normalizeStageValue(deal?.stage);
    if (dealStage) return dealStage;
  }

  if (leadId && mongoose.Types.ObjectId.isValid(String(leadId))) {
    const lead = await Lead.findById(leadId).select("stage").lean();
    const leadStage = normalizeStageValue(lead?.stage);
    if (leadStage) return leadStage;
  }

  return normalizedFallback;
}

async function syncStageToLinkedEntity(stage, { leadId, dealId }) {
  const normalizedStage = normalizeStageValue(stage);
  if (!normalizedStage) return;

  if (dealId && mongoose.Types.ObjectId.isValid(String(dealId))) {
    await Deal.updateOne(
      { _id: new mongoose.Types.ObjectId(String(dealId)) },
      { $set: { stage: normalizedStage } }
    );
  }

  if (leadId && mongoose.Types.ObjectId.isValid(String(leadId))) {
    await Lead.updateOne(
      { _id: new mongoose.Types.ObjectId(String(leadId)) },
      { $set: { stage: normalizedStage } }
    );
  }
}

async function buildLinkedStageMaps(docs = []) {
  const leadIds = [
    ...new Set(
      docs
        .map((doc) => String(doc?.leadId || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const dealIds = [
    ...new Set(
      docs
        .map((doc) => String(doc?.dealId || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const [leads, deals] = await Promise.all([
    leadIds.length ? Lead.find({ _id: { $in: leadIds } }).select("_id stage").lean() : [],
    dealIds.length ? Deal.find({ _id: { $in: dealIds } }).select("_id stage").lean() : [],
  ]);

  return {
    leadStageMap: new Map(
      leads
        .map((row) => [String(row._id), normalizeStageValue(row?.stage)])
        .filter(([, stage]) => Boolean(stage))
    ),
    dealStageMap: new Map(
      deals
        .map((row) => [String(row._id), normalizeStageValue(row?.stage)])
        .filter(([, stage]) => Boolean(stage))
    ),
  };
}

function getStageFromLinkedMaps(doc, { leadStageMap, dealStageMap }) {
  const dealId = String(doc?.dealId || "");
  const leadId = String(doc?.leadId || "");
  return dealStageMap.get(dealId) || leadStageMap.get(leadId) || "";
}

function getPrimaryPhone(value) {
  if (typeof value === "string") return value.split(",")[0].trim();
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return "";
}

async function buildFollowupPhoneMap(docs = []) {
  const followupLeadIds = [
    ...new Set(
      docs
        .map((doc) => String(doc?.leadId || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const dealIds = [
    ...new Set(
      docs
        .map((doc) => String(doc?.dealId || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const followupClientIds = [
    ...new Set(
      docs
        .map((doc) => String(doc?.clientId || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const deals = dealIds.length
    ? await Deal.find({ _id: { $in: dealIds } }).select("_id lead_id client_id").lean()
    : [];
  const dealMap = new Map(deals.map((deal) => [String(deal._id), deal]));

  const derivedLeadIds = [
    ...new Set(
      deals
        .map((deal) => String(deal?.lead_id || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const derivedClientIds = [
    ...new Set(
      deals
        .map((deal) => String(deal?.client_id || ""))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const leadIds = [...new Set([...followupLeadIds, ...derivedLeadIds])];
  const clientIds = [...new Set([...followupClientIds, ...derivedClientIds])];

  const [leadContacts, clientContacts] = await Promise.all([
    leadIds.length
      ? LeadContacts.find({ lead_id: { $in: leadIds } })
        .sort({ is_primary: -1, created_at: 1 })
        .select("lead_id phone")
        .lean()
      : [],
    clientIds.length
      ? ClientContact.find({ client_id: { $in: clientIds }, is_active: true })
        .sort({ is_primary: -1, createdAt: 1 })
        .select("client_id phone")
        .lean()
      : [],
  ]);

  const leadPhoneMap = new Map();
  for (const contact of leadContacts) {
    const leadId = String(contact?.lead_id || "");
    const phone = getPrimaryPhone(contact?.phone);
    if (!leadId || !phone || leadPhoneMap.has(leadId)) continue;
    leadPhoneMap.set(leadId, phone);
  }

  const clientPhoneMap = new Map();
  for (const contact of clientContacts) {
    const clientId = String(contact?.client_id || "");
    const phone = getPrimaryPhone(contact?.phone);
    if (!clientId || !phone || clientPhoneMap.has(clientId)) continue;
    clientPhoneMap.set(clientId, phone);
  }

  const phoneMap = new Map();
  for (const doc of docs) {
    const docId = String(doc?._id || "");
    const deal = dealMap.get(String(doc?.dealId || ""));
    const leadId = String(doc?.leadId || deal?.lead_id || "");
    const clientId = String(doc?.clientId || deal?.client_id || "");
    const phone = leadPhoneMap.get(leadId) || clientPhoneMap.get(clientId) || "";
    if (docId && phone) phoneMap.set(docId, phone);
  }

  return phoneMap;
}

async function serializeFollowupDocs(docs = []) {
  const stageMaps = await buildLinkedStageMaps(docs);
  const phoneMap = await buildFollowupPhoneMap(docs);

  return docs.map((doc) => {
    const plain = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };
    const linkedStage = getStageFromLinkedMaps(doc, stageMaps);
    if (linkedStage) plain.stage = linkedStage;
    plain.mob = phoneMap.get(String(doc?._id || "")) || "";
    return plain;
  });
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
  if (status === "overdue") return "overdue";
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

function getDurationMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 45;
  return Math.floor(n);
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function ensureNoMeetingTimeConflict({
  assignedTo,
  dueDateTime,
  durationMinutes,
  kind = "followup",
  excludeFollowupId = null,
}) {
  const assigneeId = String(assignedTo || "").trim();
  if (!assigneeId || !mongoose.Types.ObjectId.isValid(assigneeId)) return;

  const start = new Date(dueDateTime);
  if (Number.isNaN(start.getTime())) return;
  
  // Determine time window based on kind: meetings 45 min, followups 15 min
  const windowDuration = kind === "meeting" ? 45 : 15;
  
  // New event's actual duration time slot
  const newEnd = new Date(start.getTime() + windowDuration * 60 * 1000);

  const query = {
    is_deleted: { $ne: true },
    assignedTo: new mongoose.Types.ObjectId(assigneeId),
    status: { $nin: ["cancelled", "completed"] },
    // Find existing records that might overlap with our new event
    dueDateTime: {
      $gte: new Date(start.getTime() - windowDuration * 2 * 60 * 1000),
      $lt: new Date(start.getTime() + windowDuration * 2 * 60 * 1000),
    },
  };

  if (excludeFollowupId && mongoose.Types.ObjectId.isValid(String(excludeFollowupId))) {
    query._id = { $ne: new mongoose.Types.ObjectId(String(excludeFollowupId)) };
  }

  const candidates = await Followup.find(query)
    .select("_id title dueDateTime durationMinutes kind actionType status")
    .lean();

  // Check for conflicts: new event's actual time must not overlap with existing event's actual time
  const conflict = candidates.find((row) => {
    const rowStart = new Date(row.dueDateTime);
    if (Number.isNaN(rowStart.getTime())) return false;
    
    // Existing event's actual duration: 45 min for meeting, 15 min for followup
    const existingDuration = row.kind === "meeting" ? 45 : 15;
    const rowEnd = new Date(rowStart.getTime() + existingDuration * 60 * 1000);
    
    // Check if new event [start, newEnd] overlaps with existing event [rowStart, rowEnd]
    // NO lookback applied to existing events
    return intervalsOverlap(start, newEnd, rowStart, rowEnd);
  });

  if (conflict) {
    const when = new Date(conflict.dueDateTime).toLocaleString("en-IN");
    const typeLabel = kind === "meeting" ? "meeting" : "followup";
    const err = new Error(
      `Cannot schedule this ${typeLabel}! Assignee already has a ${conflict.kind} at this time (${conflict.title || conflict.kind} on ${when}).`
    );
    err.statusCode = 409;
    throw err;
  }
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
    // Keep MOM only in minutes_of_meeting; description should carry agenda/summary.
    description: doc.agenda || doc.title || "",
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

async function syncAiPriorityForDoc(doc) {
  if (!doc?._id) return;

  if (String(doc.kind || "").toLowerCase() === "followup") {
    await refreshPrioritiesForFollowupAndMeeting(doc, null);
    return;
  }

  if (isMeetingLikeFollowup(doc)) {
    const mirroredMeeting = await Meeting.findOne({ sourceFollowupId: doc._id }).lean();
    await refreshPrioritiesForFollowupAndMeeting(null, mirroredMeeting);
  }
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

  if (Array.isArray(settings.reminderOptions) && settings.reminderOptions.length > 0) {
    const first = settings.reminderOptions[0];
    const value = Number(first?.value);
    const unit = String(first?.unit || "").toLowerCase();
    if (Number.isFinite(value) && value >= 1) {
      if (unit === "minutes") return Math.floor(value);
      if (unit === "hours") return Math.floor(value * 60);
      if (unit === "days") return Math.floor(value * 24 * 60);
    }
  }

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

async function createFollowupNotification(doc, userId, eventType) {
  if (!doc || !userId) return;
  if (doc.reminderEnabled === false && eventType === "created") return;
  const settings = await CRMSettings.findOne({ userId }).lean();
  // Check if smart reminders are enabled and at least one method (inApp OR email) is enabled
  if (!settings?.smartFollowupRemindersEnabled) return;
  if (!settings?.reminderMethodInApp && !settings?.reminderMethodEmail) return;

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
  // Check if smart reminders are enabled and at least one method (inApp OR email) is enabled
  if (!settings?.smartFollowupRemindersEnabled) return;
  if (!settings?.reminderMethodInApp && !settings?.reminderMethodEmail) return;

  const isMeeting = doc.kind === "meeting";
  const itemLabel = isMeeting ? "Meeting" : "Follow-up";
  const companyName = getNotificationCompanyName(doc);
  const itemType = getNotificationItemType(doc);
  const dueAt = doc.dueDateTime ? new Date(doc.dueDateTime).toLocaleString("en-IN") : "";

  await Notification.create({
    userId,
    title: `${itemLabel} Assigned to You`,
    message: `${itemType} for ${companyName} has been assigned to you${dueAt ? ` - due ${dueAt}` : ""}.`,
    type: "info",
    relatedId: doc._id,
    relatedType: "Followup",
    templateKey: isMeeting ? TEMPLATE_KEYS.MEETING_ASSIGNED : TEMPLATE_KEYS.FOLLOWUP_ASSIGNED,
  });
}

async function runCreateSideEffects({
  doc,
  created,
  payload,
  actorId,
  assignedTo,
}) {
  try {
    await syncStageToLinkedEntity(payload.stage, payload);
  } catch (stageSyncErr) {
    console.error("followups.create stage sync error:", stageSyncErr);
  }

  try {
    await appendHistory({
      followupId: doc._id,
      actionType: "created",
      notes: `Created ${payload.kind}`,
      performedBy: actorId,
    });
  } catch (historyErr) {
    console.error("followups.create history error:", historyErr);
  }

  let mirrorReady = false;
  try {
    await syncMeetingMirrorFromFollowup(doc, actorId);
    mirrorReady = true;
  } catch (syncErr) {
    console.error("followups.create syncMeetingMirror error:", syncErr);
  }

  try {
    await syncAiPriorityForDoc(doc);
  } catch (aiErr) {
    console.error("followups.create ai priority error:", aiErr);
  }

  try {
    await createFollowupAssignmentNotification(created || doc);
  } catch (notifErr) {
    console.error("followups.create notification error:", notifErr);
  }

  try {
    await logUserDailyActivity({
      userId: actorId,
      activityId: doc._id,
      activityStatus: payload.status,
      title: payload.title,
      description: `Created ${payload.kind}`,
    });
  } catch (activityErr) {
    console.error("followups.create activity log error:", activityErr);
  }

  try {
    const assigneeId = created?.assignedTo?._id || created?.assignedTo || assignedTo;
    await createFollowupNotification(doc, assigneeId, "created");
  } catch (notificationErr) {
    console.error("followups.create notification error:", notificationErr);
  }

  if (mirrorReady && isMeetingLikeFollowup(created || doc)) {
    try {
      await syncSingleMeetingToGoogle(created || doc, created?.assignedTo?._id || created?.assignedTo || assignedTo);
    } catch (gcalErr) {
      console.error("followups.create gcal sync error:", gcalErr);
    }
  }
}

async function runUpdateSideEffects({
  current,
  updatedDoc,
  updated,
  merged,
  actorId,
}) {
  try {
    await syncStageToLinkedEntity(merged.stage, merged);
  } catch (stageSyncErr) {
    console.error("followups.update stage sync error:", stageSyncErr);
  }

  try {
    await appendHistory({
      followupId: current._id,
      actionType: "details_updated",
      notes: `Updated ${merged.kind} details`,
      performedBy: actorId,
    });
  } catch (historyErr) {
    console.error("followups.update history error:", historyErr);
  }

  try {
    await syncMeetingMirrorFromFollowup(updatedDoc, actorId);
  } catch (syncErr) {
    console.error("followups.update syncMeetingMirror error:", syncErr);
  }

  try {
    await syncAiPriorityForDoc(updatedDoc);
  } catch (aiErr) {
    console.error("followups.update ai priority error:", aiErr);
  }

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
      userId: actorId,
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
        await syncSingleMeetingToGoogle(updated, assigneeId);
      }
    } catch (gcalErr) {
      console.error("followups.update gcal sync error:", gcalErr);
    }
  }
}

async function runUpdateStatusSideEffects({
  updated,
  status,
  actorId,
}) {
  try {
    await appendHistory({
      followupId: updated._id,
      actionType: "status_changed",
      notes:
        status === "completed"
          ? `Status changed to completed${updated.durationMinutes ? ` | Duration: ${updated.durationMinutes} min` : ""}${updated.notes ? ` | MOM: ${updated.notes}` : ""}`
          : status === "cancelled"
            ? `Status changed to cancelled${updated.cancelReason ? ` | Reason: ${updated.cancelReason}` : ""}`
            : `Status changed to ${status}`,
      performedBy: actorId,
    });
  } catch (historyErr) {
    console.error("followups.updateStatus history error:", historyErr);
  }

  try {
    await syncMeetingMirrorFromFollowup(updated, actorId);
  } catch (syncErr) {
    console.error("followups.updateStatus syncMeetingMirror error:", syncErr);
  }

  try {
    await syncAiPriorityForDoc(updated);
  } catch (aiErr) {
    console.error("followups.updateStatus ai priority error:", aiErr);
  }

  try {
    await logUserDailyActivity({
      userId: actorId,
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
      await createFollowupNotification(updated, actorId, "completed");
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
}

async function runRemoveSideEffects({
  existing,
  actorId,
}) {
  if (existing.kind === "meeting") {
    try {
      await softDeleteMeetingMirror(existing._id);
    } catch (mirrorErr) {
      console.error("followups.remove mirror delete error:", mirrorErr);
    }
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
      userId: actorId,
      activityId: existing._id,
      activityStatus: "cancelled",
      title: existing.title,
      description: `Deleted ${existing.kind}`,
    });
  } catch (activityErr) {
    console.error("followups.remove activity log error:", activityErr);
  }
}

exports.list = async (req, res) => {
  try {
    const mineOnly =
      req.query.mine_only === "true" ||
      req.query.mine_only === true ||
      req.query.own_only === "true" ||
      req.query.own_only === true;
    const allowedIds = mineOnly ? [String(req.user._id)] : await getAccessibleUserIds(req.user);
    const q = {
      is_deleted: { $ne: true },
      assignedTo: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };

    if (req.query.kind) q.kind = req.query.kind;
    if (req.query.status) q.status = req.query.status;
    const requestedStage = normalizeStageValue(req.query.stage);

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

    const serializedDocs = await serializeFollowupDocs(docs);
    const responseDocs = requestedStage
      ? serializedDocs.filter((doc) => normalizeStageValue(doc?.stage) === requestedStage)
      : serializedDocs;

    res.json(responseDocs);
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
      status: { $in: ["pending", "scheduled", "rescheduled", "overdue"] },
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
    const [serializedDoc] = await serializeFollowupDocs([doc]);
    res.json(serializedDoc);
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
    const requesterRole = await resolveRequesterRoleName(req.user);
    const requesterId = String(req.user?._id || "");

    if (!allowedIds.includes(assignedTo)) {
      return res.status(403).json({ message: "You cannot assign followup to this user" });
    }
    if (isAdmin(requesterRole) && assignedTo === requesterId) {
      return res.status(403).json({ message: "Admin cannot assign followup/meeting to self" });
    }

    const stageFromRequest = normalizeStageValue(req.body.stage);
    const hasLinkedLead = mongoose.Types.ObjectId.isValid(String(req.body.leadId || ""));
    const hasLinkedDeal = mongoose.Types.ObjectId.isValid(String(req.body.dealId || ""));
    const hasLinkedEntity = hasLinkedLead || hasLinkedDeal;
    const resolvedStage = hasLinkedEntity
      ? "P2"
      : stageFromRequest ||
        (await resolveStageFromLinkedEntity({
          leadId: req.body.leadId,
          dealId: req.body.dealId,
          fallbackStage: "P1",
        }));

    const resolvedStatus = req.body.status || "pending";

    const payload = {
      kind: req.body.kind || "followup",
      actionType: req.body.actionType || "",
      title: String(req.body.title).trim(),
      leadId: req.body.leadId || undefined,
      dealId: req.body.dealId || undefined,
      clientId: req.body.clientId || undefined,
      clientName: req.body.clientName || "",
      stage: resolvedStage,
      notes: req.body.notes || "",
      cancelReason: req.body.cancelReason || "",
      priority: req.body.priority || "medium",
      status: resolvedStatus,
      completedAt: resolvedStatus === "completed" ? new Date() : null,
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

    await ensureNoMeetingTimeConflict({
      assignedTo,
      dueDateTime: payload.dueDateTime,
      durationMinutes: payload.durationMinutes,
      kind: payload.kind,
    });

    const doc = await Followup.create(payload);

    const created = await Followup.findById(doc._id).populate("assignedTo", "name email");
    const [serializedCreated] = await serializeFollowupDocs(created ? [created] : []);
    res.status(201).json(serializedCreated || created);

    void runCreateSideEffects({
      doc,
      created,
      payload,
      actorId: req.user._id,
      assignedTo,
    });
  } catch (err) {
    console.error("followups.create error:", err);
    if (err?.statusCode === 409) {
      return res.status(409).json({ message: err.message || "Meeting time conflict" });
    }
    res.status(500).json({ message: "Failed to create followup" });
  }
};

exports.update = async (req, res) => {
  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const requesterRole = await resolveRequesterRoleName(req.user);
    const requesterId = String(req.user?._id || "");
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
    if (isAdmin(requesterRole) && nextAssigned === requesterId) {
      return res.status(403).json({ message: "Admin cannot assign followup/meeting to self" });
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

    if (req.body.stage === undefined) {
      merged.stage = await resolveStageFromLinkedEntity({
        leadId: merged.leadId,
        dealId: merged.dealId,
        fallbackStage: merged.stage || current.stage || "P1",
      });
    } else {
      merged.stage = normalizeStageValue(merged.stage) || (current.stage || "P1");
    }

    const errors = validatePayload(merged);
    if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

    await ensureNoMeetingTimeConflict({
      assignedTo: nextAssigned,
      dueDateTime: merged.dueDateTime,
      durationMinutes: merged.durationMinutes,
      kind: merged.kind,
      excludeFollowupId: current._id,
    });

    await Followup.updateOne({ _id: current._id }, { $set: merged });
    const updatedDoc = await Followup.findById(current._id);
    const updated = await Followup.findById(current._id).populate("assignedTo", "name email");
    const [serializedUpdated] = await serializeFollowupDocs(updated ? [updated] : []);
    res.json(serializedUpdated || updated);

    void runUpdateSideEffects({
      current,
      updatedDoc,
      updated,
      merged,
      actorId: req.user._id,
    });
  } catch (err) {
    console.error("followups.update error:", err);
    if (err?.statusCode === 409) {
      return res.status(409).json({ message: err.message || "Meeting time conflict" });
    }
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

    if (status === "cancelled") {
      const cancelReasonRaw = req.body.cancelReason ?? "";
      const cancelReason = String(cancelReasonRaw).trim();
      if (!cancelReason) {
        return res.status(400).json({ message: "Cancellation reason is required" });
      }
      updatePayload.cancelReason = cancelReason;
    } else if (req.body.notes !== undefined) {
      updatePayload.notes = String(req.body.notes || "").trim();
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
    const refreshed = await Followup.findById(updated._id).populate("assignedTo", "name email");
    const [serializedRefreshed] = await serializeFollowupDocs(refreshed ? [refreshed] : []);
    res.json(serializedRefreshed || refreshed);

    void runUpdateStatusSideEffects({
      updated,
      status,
      actorId: req.user._id,
    });
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
    res.json({ message: "Followup deleted" });

    void runRemoveSideEffects({
      existing: updated || existing,
      actorId: req.user._id,
    });
  } catch (err) {
    console.error("followups.remove error:", err);
    res.status(500).json({ message: "Failed to delete followup" });
  }
};
