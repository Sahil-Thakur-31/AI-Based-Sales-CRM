const mongoose = require("mongoose");
const Team = require("../models/teams");
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Client = require("../models/client");
const User = require("../models/users");
const Followup = require("../models/followUp");
const SalesTarget = require("../models/sales_targets");

const ADMIN_ROLE = "Admin";
const MANAGER_ROLE = "Manager";
const LEAD_PIPELINE_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const DEAL_PIPELINE_STAGES = ["P1", "P2", "P3", "P6", "P7"];

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function toObjectId(value) {
  return new mongoose.Types.ObjectId(value);
}

function normalizeObjectIdArray(values = []) {
  if (!Array.isArray(values)) return [];

  const unique = new Set(
    values
      .map((value) => String(value || "").trim())
      .filter((value) => isObjectId(value))
  );

  return [...unique].map((value) => toObjectId(value));
}

function pickSingleLeadId(payload = {}) {
  const directLead = String(payload.teamLeadId || "").trim();
  if (isObjectId(directLead)) {
    return toObjectId(directLead);
  }

  const fromArray = normalizeObjectIdArray(payload.teamLeadIds);
  return fromArray[0] || null;
}

function isAdmin(role) {
  return String(role || "") === ADMIN_ROLE;
}

function isManager(role) {
  return String(role || "") === MANAGER_ROLE;
}

function roleNameFromUser(userDoc) {
  return userDoc?.role?.name || "";
}

function isDuplicateTeamMemberError(err) {
  const message = String(err?.message || "");
  return (
    message.includes("A member can only be assigned") ||
    (err?.code === 11000 &&
      (err?.keyPattern?.["members.userId"] ||
        message.includes("members.userId") ||
        message.includes("unique_team_member_user")))
  );
}

function mapUserForApi(userDoc) {
  return {
    _id: userDoc?._id || null,
    name: userDoc?.name || "Unknown",
    email: userDoc?.email || "",
    roleName: roleNameFromUser(userDoc)
  };
}

function teamContainsUser(teamDoc, userId) {
  const target = String(userId || "");
  if (!target) return false;

  const isLead = (teamDoc.teamLeads || []).some((lead) => String(lead.userId) === target);
  const isMember = (teamDoc.members || []).some((member) => String(member.userId) === target);
  return isLead || isMember;
}

function canManageTeam(teamDoc, requester) {
  if (!teamDoc || !requester?._id) return false;
  if (isAdmin(requester.role)) return true;
  if (!isManager(requester.role)) return false;

  return (teamDoc.teamLeads || []).some(
    (lead) => String(lead.userId) === String(requester._id)
  );
}

async function findTeamConflictsForUsers(userIds = [], excludeTeamId = null) {
  const normalizedIds = [
    ...new Set(
      (userIds || [])
        .map((id) => String(id || "").trim())
        .filter((id) => isObjectId(id))
    )
  ];
  if (!normalizedIds.length) return new Map();

  const filter = {
    $or: [
      { "teamLeads.userId": { $in: normalizedIds.map((id) => toObjectId(id)) } },
      { "members.userId": { $in: normalizedIds.map((id) => toObjectId(id)) } }
    ]
  };

  if (excludeTeamId && isObjectId(excludeTeamId)) {
    filter._id = { $ne: toObjectId(excludeTeamId) };
  }

  const teams = await Team.find(filter)
    .select("name teamLeads members")
    .lean();

  const conflictByUserId = new Map();
  for (const team of teams) {
    const teamUserIds = [
      ...(team.teamLeads || []).map((lead) => String(lead.userId || "")),
      ...(team.members || []).map((member) => String(member.userId || ""))
    ].filter(Boolean);

    for (const userId of teamUserIds) {
      if (!normalizedIds.includes(userId)) continue;
      if (!conflictByUserId.has(userId)) {
        conflictByUserId.set(userId, {
          teamId: String(team._id),
          teamName: team.name || "Untitled Team"
        });
      }
    }
  }

  return conflictByUserId;
}

async function loadUsersMap(userIds = []) {
  if (!userIds.length) return new Map();

  const users = await User.find({
    _id: { $in: userIds },
    is_deleted: { $ne: true }
  })
    .populate("role", "name")
    .select("name email role is_active is_deleted")
    .lean();

  return new Map(users.map((user) => [String(user._id), user]));
}

function mapTeamForList(teamDoc, usersMap, requester) {
  const teamLeads = (teamDoc.teamLeads || [])
    .map((lead) => usersMap.get(String(lead.userId)))
    .filter(Boolean)
    .map((leadUser) => ({ userId: mapUserForApi(leadUser) }));

  const members = (teamDoc.members || [])
    .map((member) => usersMap.get(String(member.userId)))
    .filter(Boolean)
    .map((memberUser) => ({ userId: mapUserForApi(memberUser) }));

  return {
    _id: teamDoc._id,
    name: teamDoc.name || "",
    createdAt: teamDoc.createdAt || null,
    updatedAt: teamDoc.updatedAt || null,
    teamLeads,
    members,
    leadCount: teamLeads.length,
    memberCount: members.length,
    totalPeople: teamLeads.length + members.length,
    canManage: canManageTeam(teamDoc, requester)
  };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function getTeamDashboardRange(value) {
  const normalized = String(value || "month").trim().toLowerCase();
  const range = ["today", "week", "month", "quarter", "year", "lifetime"].includes(normalized)
    ? normalized
    : "month";

  if (range === "lifetime") {
    return {
      range,
      label: "Lifetime",
      start: null,
      end: null
    };
  }

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === "week") {
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
  } else if (range === "month") {
    start.setDate(1);
  } else if (range === "quarter") {
    start.setMonth(start.getMonth() - (start.getMonth() % 3), 1);
  } else if (range === "year") {
    start.setMonth(0, 1);
  }

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const labels = {
    today: "Today",
    week: "This Week",
    month: "This Month",
    quarter: "This Quarter",
    year: "This Year"
  };

  return {
    range,
    label: labels[range] || "This Month",
    start,
    end
  };
}

function dateRangeMatch(field, selectedRange) {
  if (!selectedRange?.start || !selectedRange?.end) return {};
  return {
    [field]: {
      $gte: selectedRange.start,
      $lte: selectedRange.end
    }
  };
}

function normalizePeriodType(value) {
  const periodType = String(value || "monthly").trim().toLowerCase();
  if (periodType === "quarterly") return "quarterly";
  return "monthly";
}

function startOfDay(dateInput) {
  const value = new Date(dateInput);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(0, 0, 0, 0);
  return value;
}

function getPeriodRange(periodTypeInput, periodStartInput) {
  const periodType = normalizePeriodType(periodTypeInput);
  const now = new Date();

  let periodStart = startOfDay(periodStartInput);
  if (!periodStart) {
    if (periodType === "quarterly") {
      const month = now.getMonth();
      const quarterStartMonth = month - (month % 3);
      periodStart = new Date(now.getFullYear(), quarterStartMonth, 1);
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  let periodEnd;
  if (periodType === "quarterly") {
    periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 3, 0);
  } else {
    periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
  }
  periodEnd.setHours(23, 59, 59, 999);

  return { periodType, periodStart, periodEnd };
}

function sanitizeTargetNumber(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
  return numberValue;
}

function formatMemberDealRow(dealDoc = {}) {
  const lead = dealDoc.lead_id || null;
  const client = dealDoc.client_id || null;

  return {
    _id: dealDoc._id,
    companyName: lead?.company_name || client?.name || "Untitled Deal",
    status: dealDoc.status || "open",
    stage: dealDoc.stage || "",
    dealValue: Number(dealDoc.dealValue) || 0,
    probability: Number(dealDoc.probability) || 0,
    expectedCloseDate: dealDoc.expectedCloseDate || null,
    actualCloseDate: dealDoc.actualCloseDate || null,
    updatedAt: dealDoc.updatedAt || dealDoc.createdAt || null
  };
}

function formatMemberFollowupRow(followupDoc = {}) {
  const hasLead = Boolean(followupDoc.leadId);
  const hasDeal = Boolean(followupDoc.dealId);
  const hasClient = Boolean(followupDoc.clientId);
  const isCompleted = followupDoc.status === "completed" || Boolean(followupDoc.completedAt);

  return {
    _id: followupDoc._id,
    title: followupDoc.title || "Follow-up",
    companyName: followupDoc.clientName || "Unknown company",
    kind: followupDoc.kind || "followup",
    actionType: followupDoc.actionType || "",
    entityType: hasDeal ? "deal" : hasLead ? "lead" : hasClient ? "client" : "general",
    stage: followupDoc.stage || "",
    priority: followupDoc.priority || "medium",
    dueDateTime: followupDoc.dueDateTime || null,
    status: followupDoc.status || "pending",
    isCompleted,
    completedAt: followupDoc.completedAt || null
  };
}

function inferRecordBucketFromRefs({ leadId, dealId, clientId }) {
  if (clientId || dealId) return "deal";
  if (leadId) return "lead";
  return "deal";
}

function formatDashboardFollowupRow(followupDoc = {}) {
  const entityType = inferRecordBucketFromRefs({
    leadId: followupDoc.leadId,
    dealId: followupDoc.dealId,
    clientId: followupDoc.clientId
  });
  const isCompleted = followupDoc.status === "completed" || Boolean(followupDoc.completedAt);
  const companyName =
    followupDoc.clientName ||
    followupDoc.leadId?.company_name ||
    followupDoc.clientId?.name ||
    "Unknown company";

  return {
    _id: followupDoc._id || null,
    title: followupDoc.title || "Follow-up",
    companyName,
    kind: followupDoc.kind || "followup",
    notes: followupDoc.notes || "",
    actionType: followupDoc.actionType || "",
    stage: followupDoc.stage || "",
    status: followupDoc.status || "pending",
    isCompleted,
    entityType,
    priority: followupDoc.priority || "medium",
    dueDateTime: followupDoc.dueDateTime || null,
    completedAt: followupDoc.completedAt || null,
    assignedTo: followupDoc.assignedTo
      ? {
          _id: followupDoc.assignedTo._id,
          name: followupDoc.assignedTo.name || "Unknown",
          email: followupDoc.assignedTo.email || ""
        }
      : null
  };
}

function formatMemberLeadRow(leadDoc = {}) {
  const status = String(leadDoc.status || "new");
  return {
    _id: leadDoc._id || null,
    companyName: leadDoc.company_name || "Unknown company",
    status,
    temperature: leadDoc.lead_temperature || "cold",
    estimatedValue: Number(leadDoc.deal_value_estimate || 0),
    nextAction: leadDoc.next_action || "",
    lastContactDate: leadDoc.last_contact_date || null,
    convertedToDeal: status === "converted" || Boolean(leadDoc.converted_to_deal),
    updatedAt: leadDoc.updated_at || leadDoc.created_at || null
  };
}

function buildEmptyPipeline(stageOrder = []) {
  return {
    totals: {
      count: 0,
      value: 0
    },
    stages: stageOrder.map((stage) => ({
      stage,
      count: 0,
      value: 0,
      items: []
    }))
  };
}

function summarizeDealPipeline(deals = [], usersMap = new Map(), stageOrder = DEAL_PIPELINE_STAGES) {
  const stageMap = new Map(
    stageOrder.map((stage) => [
      stage,
      {
        stage,
        count: 0,
        value: 0,
        items: []
      }
    ])
  );

  let totalCount = 0;
  let totalValue = 0;

  for (const deal of deals) {
    const stage = stageOrder.includes(String(deal.stage || "")) ? String(deal.stage || "") : null;
    if (!stage) continue;
    const stageEntry = stageMap.get(stage);
    if (!stageEntry) continue;

    const dealValue = Number(deal.dealValue || 0);
    const assignedUser = usersMap.get(String(deal.assignedTo || ""));

    stageEntry.count += 1;
    stageEntry.value += dealValue;
    stageEntry.items.push({
      _id: deal._id,
      companyName: deal.companyName || "Untitled Deal",
      stage,
      status: deal.status || "open",
      dealValue,
      probability: Number(deal.probability || 0),
      expectedCloseDate: deal.expectedCloseDate || null,
      updatedAt: deal.updatedAt || deal.createdAt || null,
      assignedTo: assignedUser ? mapUserForApi(assignedUser) : null
    });

    totalCount += 1;
    totalValue += dealValue;
  }

  return {
    totals: {
      count: totalCount,
      value: totalValue
    },
    stages: stageOrder.map((stage) => stageMap.get(stage))
  };
}

function summarizeLeadPipeline({
  leadFollowups = [],
  usersMap = new Map(),
  leadsMap = new Map(),
  stageOrder = LEAD_PIPELINE_STAGES
}) {
  const stageMap = new Map(
    stageOrder.map((stage) => [
      stage,
      {
        stage,
        count: 0,
        value: 0,
        items: []
      }
    ])
  );

  let totalCount = 0;
  let totalValue = 0;

  for (const row of leadFollowups) {
    const stage = stageOrder.includes(String(row.stage || "")) ? String(row.stage || "") : null;
    if (!stage) continue;
    const stageEntry = stageMap.get(stage);
    if (!stageEntry) continue;

    const lead = leadsMap.get(String(row.leadId || ""));
    if (!lead) continue;
    const assignedUser = usersMap.get(String(row.assignedTo || ""));
    const estimatedValue = Number(lead?.deal_value_estimate || 0);

    stageEntry.count += 1;
    stageEntry.value += estimatedValue;
    stageEntry.items.push({
      _id: row._id,
      leadId: row.leadId,
      companyName: lead?.company_name || row.clientName || "Untitled Lead",
      stage,
      status: row.status || "pending",
      actionType: row.actionType || "",
      title: row.title || "Follow-up",
      dueDateTime: row.dueDateTime || null,
      updatedAt: row.updatedAt || row.createdAt || null,
      estimatedValue,
      leadStatus: lead?.status || "new",
      temperature: lead?.lead_temperature || "cold",
      assignedTo: assignedUser ? mapUserForApi(assignedUser) : null
    });

    totalCount += 1;
    totalValue += estimatedValue;
  }

  return {
    totals: {
      count: totalCount,
      value: totalValue
    },
    stages: stageOrder.map((stage) => stageMap.get(stage))
  };
}

function buildInsights({ winRate, closedDeals, followupsToday, activeDeals, memberPerformance }) {
  const insights = [];

  if (activeDeals === 0) {
    insights.push({
      type: "pipeline",
      severity: "high",
      message: "No active deals in the current team pipeline."
    });
  } else if (closedDeals > 0 && winRate < 30) {
    insights.push({
      type: "conversion",
      severity: "medium",
      message: "Win rate is below 30%. Review qualification and proposal strategy."
    });
  }

  if (followupsToday > 10) {
    insights.push({
      type: "followups",
      severity: "medium",
      message: `${followupsToday} follow-ups are due today. Prioritize high-value accounts first.`
    });
  } else if (followupsToday === 0) {
    insights.push({
      type: "followups",
      severity: "low",
      message: "No follow-ups due today."
    });
  }

  if (memberPerformance.length) {
    const topPerformer = [...memberPerformance].sort(
      (a, b) => b.wonRevenue - a.wonRevenue || b.wonDeals - a.wonDeals
    )[0];

    if (topPerformer && topPerformer.wonRevenue > 0) {
      insights.push({
        type: "top-performer",
        severity: "low",
        message: `${topPerformer.user.name} is leading with ${topPerformer.wonDeals} won deal(s).`
      });
    }
  }

  if (!insights.length) {
    insights.push({
      type: "summary",
      severity: "low",
      message: "Team activity is stable. Keep momentum on follow-ups and negotiations."
    });
  }

  return insights;
}

function getEmptyLeadSummary() {
  return {
    total: 0,
    new: 0,
    contacted: 0,
    qualified: 0,
    converted: 0,
    rejected: 0,
    hot: 0,
    warm: 0,
    cold: 0
  };
}

function getActiveLeadMatch(extraMatch = {}) {
  return {
    ...extraMatch,
    is_deleted: { $ne: true },
    status: { $ne: "converted" },
    converted_to_deal: { $ne: true },
    $or: [{ converted_deal_id: { $exists: false } }, { converted_deal_id: null }]
  };
}

async function resolveTeamForDashboard(requester, teamId) {
  const query = {};

  if (!isAdmin(requester.role)) {
    query["teamLeads.userId"] = requester._id;
  }

  if (teamId) {
    if (!isObjectId(teamId)) return null;
    query._id = toObjectId(teamId);
    return Team.findOne(query).lean();
  }

  return Team.findOne(query).sort({ updatedAt: -1, createdAt: -1 }).lean();
}

exports.createTeam = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ message: "Only admins can create teams" });
    }

    const { name, members } = req.body || {};
    const rawLeadIds = normalizeObjectIdArray(req.body?.teamLeadIds);
    if (rawLeadIds.length > 1) {
      return res.status(400).json({ message: "Only one team lead is allowed" });
    }
    const selectedLeadId = pickSingleLeadId(req.body || {});
    const normalizedMemberIds = normalizeObjectIdArray(members);

    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return res.status(400).json({ message: "Team name is required" });
    }

    if (!selectedLeadId) {
      return res.status(400).json({ message: "A team lead is required" });
    }

    const duplicateTeam = await Team.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(normalizedName)}$`, "i") }
    }).select("_id");

    if (duplicateTeam) {
      return res.status(400).json({ message: "A team with this name already exists" });
    }

    const [leadUsers, memberUsers] = await Promise.all([
      User.find({
        _id: selectedLeadId,
        is_deleted: { $ne: true },
        is_active: true
      })
        .populate("role", "name")
        .select("name email role is_active is_deleted")
        .lean(),
      normalizedMemberIds.length
        ? User.find({
            _id: { $in: normalizedMemberIds },
            is_deleted: { $ne: true },
            is_active: true
          })
            .populate("role", "name")
            .select("name email role is_active is_deleted")
            .lean()
        : []
    ]);

    if (leadUsers.length !== 1) {
      return res.status(400).json({ message: "Selected team lead is invalid" });
    }

    const invalidLead = leadUsers.find((user) => roleNameFromUser(user) !== MANAGER_ROLE);
    if (invalidLead) {
      return res.status(400).json({
        message: "Only users with Manager role can be team leads"
      });
    }

    if (memberUsers.length !== normalizedMemberIds.length) {
      return res.status(400).json({ message: "One or more selected members are invalid" });
    }

    const invalidMember = memberUsers.find((user) => roleNameFromUser(user) === ADMIN_ROLE);
    if (invalidMember) {
      return res.status(400).json({ message: "Admin users cannot be team members" });
    }

    const leadIdSet = new Set([String(selectedLeadId)]);
    const filteredMembers = normalizedMemberIds.filter((id) => !leadIdSet.has(String(id)));
    const conflictMap = await findTeamConflictsForUsers([
      String(selectedLeadId),
      ...filteredMembers.map((id) => String(id))
    ]);

    if (conflictMap.has(String(selectedLeadId))) {
      const conflict = conflictMap.get(String(selectedLeadId));
      return res.status(400).json({
        message: `Selected team lead is already assigned to team "${conflict.teamName}"`
      });
    }

    const conflictedMember = filteredMembers.find((id) => conflictMap.has(String(id)));
    if (conflictedMember) {
      const conflict = conflictMap.get(String(conflictedMember));
      const user = memberUsers.find((row) => String(row._id) === String(conflictedMember));
      const userLabel = user?.name || user?.email || "Selected member";
      return res.status(400).json({
        message: `${userLabel} is already assigned to team "${conflict.teamName}"`
      });
    }

    const team = await Team.create({
      name: normalizedName,
      teamLeads: [{ userId: selectedLeadId }],
      members: filteredMembers.map((id) => ({ userId: id })),
      createdBy: req.user._id
    });

    const usersMap = await loadUsersMap([
      String(selectedLeadId),
      ...filteredMembers.map((id) => String(id))
    ]);

    return res.status(201).json(
      mapTeamForList(team.toObject(), usersMap, req.user)
    );
  } catch (err) {
    console.error(err);
    if (isDuplicateTeamMemberError(err)) {
      return res.status(400).json({ message: "A member can only be assigned to one team" });
    }
    return res.status(500).json({ message: "Failed to create team" });
  }
};

exports.updateTeam = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const teamId = String(req.params?.teamId || "").trim();
    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid team id is required" });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "You are not allowed to edit this team" });
    }

    const { name, members } = req.body || {};
    const rawLeadIds = normalizeObjectIdArray(req.body?.teamLeadIds);
    if (rawLeadIds.length > 1) {
      return res.status(400).json({ message: "Only one team lead is allowed" });
    }

    const selectedLeadId = pickSingleLeadId(req.body || {});
    const normalizedMemberIds = normalizeObjectIdArray(members);

    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return res.status(400).json({ message: "Team name is required" });
    }

    if (!selectedLeadId) {
      return res.status(400).json({ message: "A team lead is required" });
    }

    const duplicateTeam = await Team.findOne({
      _id: { $ne: team._id },
      name: { $regex: new RegExp(`^${escapeRegex(normalizedName)}$`, "i") }
    }).select("_id");

    if (duplicateTeam) {
      return res.status(400).json({ message: "A team with this name already exists" });
    }

    const [leadUsers, memberUsers] = await Promise.all([
      User.find({
        _id: selectedLeadId,
        is_deleted: { $ne: true },
        is_active: true
      })
        .populate("role", "name")
        .select("name email role is_active is_deleted")
        .lean(),
      normalizedMemberIds.length
        ? User.find({
            _id: { $in: normalizedMemberIds },
            is_deleted: { $ne: true },
            is_active: true
          })
            .populate("role", "name")
            .select("name email role is_active is_deleted")
            .lean()
        : []
    ]);

    if (leadUsers.length !== 1) {
      return res.status(400).json({ message: "Selected team lead is invalid" });
    }

    const invalidLead = leadUsers.find((user) => roleNameFromUser(user) !== MANAGER_ROLE);
    if (invalidLead) {
      return res.status(400).json({
        message: "Only users with Manager role can be team leads"
      });
    }

    if (memberUsers.length !== normalizedMemberIds.length) {
      return res.status(400).json({ message: "One or more selected members are invalid" });
    }

    const invalidMember = memberUsers.find((user) => roleNameFromUser(user) === ADMIN_ROLE);
    if (invalidMember) {
      return res.status(400).json({ message: "Admin users cannot be team members" });
    }

    const leadIdSet = new Set([String(selectedLeadId)]);
    const filteredMembers = normalizedMemberIds.filter((id) => !leadIdSet.has(String(id)));
    const conflictMap = await findTeamConflictsForUsers(
      [String(selectedLeadId), ...filteredMembers.map((id) => String(id))],
      String(team._id)
    );

    if (conflictMap.has(String(selectedLeadId))) {
      const conflict = conflictMap.get(String(selectedLeadId));
      return res.status(400).json({
        message: `Selected team lead is already assigned to team "${conflict.teamName}"`
      });
    }

    const conflictedMember = filteredMembers.find((id) => conflictMap.has(String(id)));
    if (conflictedMember) {
      const conflict = conflictMap.get(String(conflictedMember));
      const user = memberUsers.find((row) => String(row._id) === String(conflictedMember));
      const userLabel = user?.name || user?.email || "Selected member";
      return res.status(400).json({
        message: `${userLabel} is already assigned to team "${conflict.teamName}"`
      });
    }

    team.name = normalizedName;
    team.teamLeads = [{ userId: selectedLeadId }];
    team.members = filteredMembers.map((id) => ({ userId: id }));
    await team.save();

    const usersMap = await loadUsersMap([
      String(selectedLeadId),
      ...filteredMembers.map((id) => String(id))
    ]);

    return res.json(mapTeamForList(team.toObject(), usersMap, req.user));
  } catch (err) {
    console.error(err);
    if (isDuplicateTeamMemberError(err)) {
      return res.status(400).json({ message: "A member can only be assigned to one team" });
    }
    return res.status(500).json({ message: "Failed to update team" });
  }
};

exports.deleteTeam = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const teamId = String(req.params?.teamId || "").trim();
    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid team id is required" });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "You are not allowed to delete this team" });
    }

    await Team.deleteOne({ _id: team._id });
    return res.json({ message: "Team deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to delete team" });
  }
};

exports.listTeams = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const filter = isAdmin(req.user.role)
      ? {}
      : { "teamLeads.userId": req.user._id };

    const teams = await Team.find(filter).sort({ updatedAt: -1, createdAt: -1 }).lean();

    const userIds = [
      ...new Set(
        teams
          .flatMap((team) => [
            ...(team.teamLeads || []).map((lead) => String(lead.userId)),
            ...(team.members || []).map((member) => String(member.userId))
          ])
          .filter(Boolean)
      )
    ];

    const usersMap = await loadUsersMap(userIds);
    const response = teams.map((team) => mapTeamForList(team, usersMap, req.user));

    return res.json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch teams" });
  }
};

exports.addMember = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, userId } = req.body || {};

    if (!isObjectId(teamId) || !isObjectId(userId)) {
      return res.status(400).json({ message: "Valid teamId and userId are required" });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "You are not allowed to modify this team" });
    }

    const targetUser = await User.findOne({
      _id: userId,
      is_deleted: { $ne: true },
      is_active: true
    })
      .populate("role", "name")
      .lean();

    if (!targetUser) {
      return res.status(404).json({ message: "User not found or inactive" });
    }

    if (roleNameFromUser(targetUser) === ADMIN_ROLE) {
      return res.status(400).json({ message: "Admin users cannot be team members" });
    }

    if (teamContainsUser(team, userId)) {
      return res.status(400).json({ message: "User already exists in this team" });
    }

    const conflictMap = await findTeamConflictsForUsers([String(userId)], String(team._id));
    if (conflictMap.has(String(userId))) {
      const conflict = conflictMap.get(String(userId));
      return res.status(400).json({
        message: `User is already assigned to team "${conflict.teamName}"`
      });
    }

    team.members.push({ userId });
    await team.save();

    return res.json({ message: "Member added successfully" });
  } catch (err) {
    console.error(err);
    if (isDuplicateTeamMemberError(err)) {
      return res.status(400).json({ message: "A member can only be assigned to one team" });
    }
    return res.status(500).json({ message: "Failed to add member" });
  }
};

exports.removeMember = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, userId } = req.body || {};

    if (!isObjectId(teamId) || !isObjectId(userId)) {
      return res.status(400).json({ message: "Valid teamId and userId are required" });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "You are not allowed to modify this team" });
    }

    const initialLength = team.members.length;
    team.members = team.members.filter((member) => String(member.userId) !== String(userId));

    if (team.members.length === initialLength) {
      return res.status(404).json({ message: "Member not found in this team" });
    }

    await team.save();
    return res.json({ message: "Member removed successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to remove member" });
  }
};

exports.getTeamDashboard = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can view team dashboard" });
    }

    const team = await resolveTeamForDashboard(req.user, req.query?.teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }
    const selectedRange = getTeamDashboardRange(req.query?.range);

    const leadIds = (team.teamLeads || []).map((lead) => String(lead.userId));
    const memberIds = (team.members || []).map((member) => String(member.userId));
    const allUserIds = [...new Set([...leadIds, ...memberIds])].filter(Boolean);

    const usersMap = await loadUsersMap(allUserIds);
    const teamLeads = leadIds
      .map((id) => usersMap.get(id))
      .filter(Boolean)
      .map(mapUserForApi);
    const members = memberIds
      .map((id) => usersMap.get(id))
      .filter(Boolean)
      .map(mapUserForApi);

    const emptyDealPipeline = buildEmptyPipeline(DEAL_PIPELINE_STAGES);
    const emptyLeadPipeline = buildEmptyPipeline(LEAD_PIPELINE_STAGES);

    if (!allUserIds.length) {
      return res.json({
        team: {
          _id: team._id,
          name: team.name || "",
          teamLeadId: teamLeads[0]?._id || null,
          leadCount: 0,
          memberCount: 0,
          totalPeople: 0
        },
        range: selectedRange,
        teamLeads,
        members,
        kpis: {
          followupsToday: 0,
          activeDeals: 0,
          pipelineValue: 0,
          winRate: 0,
          wonRevenue: 0,
          closedDeals: 0,
          totalLeads: 0
        },
        pipeline: {
          deal: {
            totals: emptyDealPipeline.totals,
            stages: emptyDealPipeline.stages.map((stage) => ({
              stage: stage.stage,
              count: stage.count,
              value: stage.value
            }))
          },
          lead: {
            totals: emptyLeadPipeline.totals,
            stages: emptyLeadPipeline.stages.map((stage) => ({
              stage: stage.stage,
              count: stage.count,
              value: stage.value
            }))
          }
        },
        leads: getEmptyLeadSummary(),
        recentLeads: [],
        followups: {
          lead: [],
          deal: []
        },
        stageDistribution: emptyDealPipeline.stages.map((stage) => ({
          stage: stage.stage,
          count: stage.count
        })),
        memberPerformance: [],
        insights: [
          {
            type: "team",
            severity: "low",
            message: "No users are assigned to this team yet."
          }
        ]
      });
    }

    const memberObjectIds = allUserIds.map((id) => toObjectId(id));
    const dealsMatch = {
      assignedTo: { $in: memberObjectIds },
      is_deleted: { $ne: true },
      ...dateRangeMatch("createdAt", selectedRange)
    };

    const followupDueMatch = dateRangeMatch("dueDateTime", selectedRange);
    const leadDateMatch = dateRangeMatch("created_at", selectedRange);

    const [
      dealStatusAgg,
      memberDealAgg,
      activeDealRows,
      followupsToday,
      followupRows,
      followupByMemberAgg,
      leadStatusAgg,
      leadTempAgg,
      recentLeadRows,
      memberLeadAgg,
      leadPipelineRawRows
    ] = await Promise.all([
      Deal.aggregate([
        { $match: dealsMatch },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$dealValue", 0] } }
          }
        }
      ]),
      Deal.aggregate([
        { $match: dealsMatch },
        {
          $group: {
            _id: "$assignedTo",
            openDeals: {
              $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] }
            },
            wonDeals: {
              $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] }
            },
            lostDeals: {
              $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] }
            },
            pipelineValue: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "open"] },
                  { $ifNull: ["$dealValue", 0] },
                  0
                ]
              }
            },
            wonRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "won"] },
                  { $ifNull: ["$dealValue", 0] },
                  0
                ]
              }
            }
          }
        }
      ]),
      Deal.find({
        assignedTo: { $in: memberObjectIds },
        is_deleted: { $ne: true },
        status: "open",
        stage: { $in: DEAL_PIPELINE_STAGES },
        ...dateRangeMatch("createdAt", selectedRange)
      })
        .select(
          "_id assignedTo stage dealValue probability expectedCloseDate status updatedAt createdAt lead_id client_id"
        )
        .populate("lead_id", "company_name")
        .populate("client_id", "name")
        .lean(),
      Followup.countDocuments({
        assignedTo: { $in: memberObjectIds },
        is_deleted: { $ne: true },
        ...followupDueMatch,
        status: { $in: ["pending", "overdue"] }
      }),
      Followup.find({
        assignedTo: { $in: memberObjectIds },
        is_deleted: { $ne: true },
        ...followupDueMatch,
        status: { $ne: "cancelled" }
      })
        .select(
          "title clientName notes kind actionType stage priority dueDateTime status completedAt leadId dealId clientId assignedTo"
        )
        .populate("assignedTo", "name email")
        .populate("leadId", "company_name")
        .populate("clientId", "name")
        .sort({ dueDateTime: 1, createdAt: 1 })
        .lean(),
      Followup.aggregate([
        {
          $match: {
            assignedTo: { $in: memberObjectIds },
            is_deleted: { $ne: true },
            ...followupDueMatch,
            status: { $in: ["pending", "overdue"] }
          }
        },
        {
          $group: {
            _id: "$assignedTo",
            count: { $sum: 1 }
          }
        }
      ]),
      Lead.aggregate([
        {
          $match: getActiveLeadMatch({
            assigned_to: { $in: memberObjectIds },
            ...leadDateMatch
          })
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      Lead.aggregate([
        {
          $match: getActiveLeadMatch({
            assigned_to: { $in: memberObjectIds },
            ...leadDateMatch
          })
        },
        {
          $group: {
            _id: "$lead_temperature",
            count: { $sum: 1 }
          }
        }
      ]),
      Lead.find(
        getActiveLeadMatch({
          assigned_to: { $in: memberObjectIds },
          ...leadDateMatch
        })
      )
        .sort({ updated_at: -1, created_at: -1 })
        .limit(8)
        .select(
          "company_name status lead_temperature assigned_to next_action last_contact_date deal_value_estimate converted_to_deal created_at updated_at"
        )
        .populate("assigned_to", "name email")
        .lean(),
      Lead.aggregate([
        {
          $match: getActiveLeadMatch({
            assigned_to: { $in: memberObjectIds },
            ...leadDateMatch
          })
        },
        {
          $group: {
            _id: "$assigned_to",
            totalLeads: { $sum: 1 },
            hotLeads: {
              $sum: { $cond: [{ $eq: ["$lead_temperature", "hot"] }, 1, 0] }
            }
          }
        }
      ]),
      Followup.find({
        assignedTo: { $in: memberObjectIds },
        is_deleted: { $ne: true },
        status: { $ne: "cancelled" },
        leadId: { $exists: true, $ne: null },
        ...dateRangeMatch("dueDateTime", selectedRange)
      })
        .select("leadId assignedTo stage status actionType title dueDateTime clientName updatedAt createdAt")
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean()
    ]);

    const dealStatusMap = new Map(dealStatusAgg.map((item) => [String(item._id), item]));
    const openDeals = dealStatusMap.get("open")?.count || 0;
    const wonDeals = dealStatusMap.get("won")?.count || 0;
    const lostDeals = dealStatusMap.get("lost")?.count || 0;
    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals ? Math.round((wonDeals / closedDeals) * 100) : 0;
    const pipelineValue = dealStatusMap.get("open")?.value || 0;
    const wonRevenue = dealStatusMap.get("won")?.value || 0;

    const followupByMemberMap = new Map(
      followupByMemberAgg.map((item) => [String(item._id), item.count])
    );

    const memberDealMap = new Map(
      memberDealAgg.map((item) => [String(item._id), item])
    );
    const memberLeadMap = new Map(
      memberLeadAgg.map((item) => [String(item._id), item])
    );

    const dealPipelineRows = (activeDealRows || []).map((deal) => ({
      _id: deal._id,
      stage: deal.stage || "",
      status: deal.status || "open",
      dealValue: Number(deal.dealValue || 0),
      probability: Number(deal.probability || 0),
      expectedCloseDate: deal.expectedCloseDate || null,
      updatedAt: deal.updatedAt || deal.createdAt || null,
      assignedTo: deal.assignedTo || null,
      companyName: deal.lead_id?.company_name || deal.client_id?.name || "Untitled Deal"
    }));
    const dealPipeline = summarizeDealPipeline(dealPipelineRows, usersMap, DEAL_PIPELINE_STAGES);

    const latestLeadFollowups = [];
    const seenLeadIds = new Set();
    for (const row of leadPipelineRawRows || []) {
      const leadId = String(row?.leadId || "");
      if (!leadId || seenLeadIds.has(leadId)) continue;
      seenLeadIds.add(leadId);
      latestLeadFollowups.push(row);
    }

    const leadPipelineLeadIds = latestLeadFollowups
      .map((row) => String(row?.leadId || ""))
      .filter(Boolean);
    const leadPipelineLeadDocs = leadPipelineLeadIds.length
      ? await Lead.find(
          getActiveLeadMatch({
            _id: { $in: leadPipelineLeadIds }
          })
        )
          .select("company_name status lead_temperature deal_value_estimate")
          .lean()
      : [];
    const leadPipelineLeadMap = new Map(
      leadPipelineLeadDocs.map((lead) => [String(lead._id), lead])
    );
    const leadPipeline = summarizeLeadPipeline({
      leadFollowups: latestLeadFollowups,
      usersMap,
      leadsMap: leadPipelineLeadMap,
      stageOrder: LEAD_PIPELINE_STAGES
    });

    const memberPerformance = allUserIds
      .map((userId) => {
        const user = usersMap.get(String(userId));
        if (!user) return null;

        const perf = memberDealMap.get(String(userId)) || {
          openDeals: 0,
          wonDeals: 0,
          lostDeals: 0,
          pipelineValue: 0,
          wonRevenue: 0
        };
        const leadPerf = memberLeadMap.get(String(userId)) || {
          totalLeads: 0,
          hotLeads: 0
        };

        const userClosed = (perf.wonDeals || 0) + (perf.lostDeals || 0);
        const userWinRate = userClosed ? Math.round(((perf.wonDeals || 0) / userClosed) * 100) : 0;
        const totalLeads = Number(leadPerf.totalLeads || 0);
        const convertedLeads = 0;
        const leadConversionRate = 0;

        return {
          user: mapUserForApi(user),
          totalLeads,
          convertedLeads,
          hotLeads: Number(leadPerf.hotLeads || 0),
          leadConversionRate,
          openDeals: perf.openDeals || 0,
          wonDeals: perf.wonDeals || 0,
          lostDeals: perf.lostDeals || 0,
          pipelineValue: perf.pipelineValue || 0,
          wonRevenue: perf.wonRevenue || 0,
          winRate: userWinRate,
          followupsToday: followupByMemberMap.get(String(userId)) || 0
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.wonRevenue - a.wonRevenue ||
          b.pipelineValue - a.pipelineValue ||
          b.totalLeads - a.totalLeads ||
          b.followupsToday - a.followupsToday
      );

    const followupBuckets = {
      lead: [],
      deal: []
    };
    (followupRows || []).forEach((followupDoc) => {
      const row = formatDashboardFollowupRow(followupDoc);
      const bucket = row.entityType === "lead" ? "lead" : "deal";
      followupBuckets[bucket].push(row);
    });

    const leadSummary = getEmptyLeadSummary();
    const statusMap = new Map((leadStatusAgg || []).map((item) => [String(item?._id || ""), Number(item?.count || 0)]));
    const tempMap = new Map((leadTempAgg || []).map((item) => [String(item?._id || ""), Number(item?.count || 0)]));

    leadSummary.new = statusMap.get("new") || 0;
    leadSummary.contacted = statusMap.get("contacted") || 0;
    leadSummary.qualified = statusMap.get("qualified") || 0;
    leadSummary.converted = 0;
    leadSummary.rejected = statusMap.get("rejected") || 0;
    leadSummary.total = Array.from(statusMap.values()).reduce((acc, count) => acc + count, 0);
    leadSummary.hot = tempMap.get("hot") || 0;
    leadSummary.warm = tempMap.get("warm") || 0;
    leadSummary.cold = tempMap.get("cold") || 0;

    const recentLeads = (recentLeadRows || []).map((lead) => {
      const row = formatMemberLeadRow(lead);
      return {
        ...row,
        assignedTo: lead?.assigned_to
          ? {
              _id: lead.assigned_to._id,
              name: lead.assigned_to.name || "Unknown",
              email: lead.assigned_to.email || ""
            }
          : null
      };
    });

    const dashboardPipeline = {
      deal: {
        totals: dealPipeline.totals,
        stages: dealPipeline.stages.map((stage) => ({
          stage: stage.stage,
          count: stage.count,
          value: stage.value
        }))
      },
      lead: {
        totals: leadPipeline.totals,
        stages: leadPipeline.stages.map((stage) => ({
          stage: stage.stage,
          count: stage.count,
          value: stage.value
        }))
      }
    };

    const insights = buildInsights({
      winRate,
      closedDeals,
      followupsToday,
      activeDeals: openDeals,
      memberPerformance
    });
    const activeLeadCount = Math.max(0, Number(leadSummary.total || 0));

    return res.json({
      team: {
        _id: team._id,
        name: team.name || "",
        teamLeadId: teamLeads[0]?._id || null,
        leadCount: teamLeads.length,
        memberCount: members.length,
        totalPeople: teamLeads.length + members.length
      },
      teamLeads,
      members,
      range: selectedRange,
      kpis: {
        followupsToday,
        activeDeals: openDeals,
        pipelineValue,
        winRate,
        wonRevenue,
        closedDeals,
        totalLeads: activeLeadCount
      },
      pipeline: dashboardPipeline,
      leads: leadSummary,
      recentLeads,
      followups: followupBuckets,
      stageDistribution: dashboardPipeline.deal.stages.map((stage) => ({
        stage: stage.stage,
        count: stage.count
      })),
      memberPerformance,
      insights
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load team dashboard" });
  }
};

exports.getTeamMemberDetail = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can view member details" });
    }

    const teamId = String(req.query?.teamId || "").trim();
    const memberId = String(req.query?.memberId || "").trim();

    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }

    if (!isObjectId(memberId)) {
      return res.status(400).json({ message: "Valid memberId is required" });
    }

    const team = await resolveTeamForDashboard(req.user, teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!teamContainsUser(team, memberId)) {
      return res.status(403).json({ message: "Selected user is not part of this team" });
    }
    const selectedRange = getTeamDashboardRange(req.query?.range);

    const user = await User.findOne({
      _id: memberId,
      is_deleted: { $ne: true }
    })
      .populate("role", "name")
      .select("name email role is_active is_deleted")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "Member not found" });
    }

    const memberObjectId = toObjectId(memberId);
    const now = new Date();

    const [deals, followups, memberLeads, activeTargetDoc] = await Promise.all([
      Deal.find({
        assignedTo: memberObjectId,
        is_deleted: { $ne: true },
        status: { $in: ["open", "won", "lost"] },
        ...dateRangeMatch("createdAt", selectedRange)
      })
        .populate("client_id", "name")
        .populate("lead_id", "company_name")
        .select(
          "status stage dealValue probability expectedCloseDate actualCloseDate updatedAt createdAt client_id lead_id"
        )
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
      Followup.find({
        assignedTo: memberObjectId,
        is_deleted: { $ne: true },
        ...dateRangeMatch("dueDateTime", selectedRange),
        status: { $ne: "cancelled" }
      })
        .select(
          "title clientName kind actionType leadId dealId clientId stage priority dueDateTime status completedAt"
        )
        .sort({ dueDateTime: 1, createdAt: 1 })
        .lean(),
      Lead.find(
        getActiveLeadMatch({
          assigned_to: memberObjectId,
          ...dateRangeMatch("created_at", selectedRange)
        })
      )
        .select(
          "company_name status lead_temperature deal_value_estimate next_action last_contact_date converted_to_deal created_at updated_at"
        )
        .sort({ updated_at: -1, created_at: -1 })
        .lean(),
      SalesTarget.findOne({
        user_id: memberObjectId,
        team_id: team._id,
        $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }],
        status: { $ne: "archived" },
        period_start: { $lte: now },
        period_end: { $gte: now }
      })
        .sort({ period_end: 1 })
        .lean()
    ]);

    const groupedDeals = {
      open: [],
      won: [],
      lost: []
    };

    for (const deal of deals) {
      const row = formatMemberDealRow(deal);
      if (row.status === "won") groupedDeals.won.push(row);
      else if (row.status === "lost") groupedDeals.lost.push(row);
      else groupedDeals.open.push(row);
    }

    const targetDoc =
      activeTargetDoc ||
      (await SalesTarget.findOne({
        user_id: memberObjectId,
        team_id: team._id,
        $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }],
        status: { $ne: "archived" }
      })
        .sort({ period_end: -1, updated_at: -1 })
        .lean());

    const targetStart = targetDoc?.period_start ? new Date(targetDoc.period_start) : null;
    const targetEnd = targetDoc?.period_end ? new Date(targetDoc.period_end) : null;

    let targetProgress = null;
    if (targetDoc && targetStart && targetEnd) {
      const [wonAgg, completedFollowups] = await Promise.all([
        Deal.aggregate([
          {
            $match: {
              assignedTo: memberObjectId,
              status: "won",
              is_deleted: { $ne: true },
              $or: [
                { actualCloseDate: { $gte: targetStart, $lte: targetEnd } },
                {
                  actualCloseDate: null,
                  updatedAt: { $gte: targetStart, $lte: targetEnd }
                }
              ]
            }
          },
          {
            $group: {
              _id: null,
              achievedRevenue: { $sum: { $ifNull: ["$dealValue", 0] } },
              achievedDeals: { $sum: 1 }
            }
          }
        ]),
        Followup.countDocuments({
          assignedTo: memberObjectId,
          is_deleted: { $ne: true },
          status: "completed",
          completedAt: { $gte: targetStart, $lte: targetEnd }
        })
      ]);

      const achievedRevenue = Number(wonAgg?.[0]?.achievedRevenue || 0);
      const achievedDeals = Number(wonAgg?.[0]?.achievedDeals || 0);
      const revenueTarget = Number(targetDoc?.revenue_target || 0);
      const progressPercent = revenueTarget
        ? Math.min(100, Math.round((achievedRevenue / revenueTarget) * 100))
        : 0;

      targetProgress = {
        periodType: targetDoc?.period_type || "monthly",
        periodStart: targetStart,
        periodEnd: targetEnd,
        revenueTarget,
        achievedRevenue,
        dealTarget: Number(targetDoc?.deal_target || 0),
        achievedDeals,
        followupTarget: Number(targetDoc?.followup_target || 0),
        achievedFollowups: Number(completedFollowups || 0),
        progressPercent
      };
    }

    const leads = (memberLeads || []).map(formatMemberLeadRow);
    const leadSummary = leads.reduce(
      (acc, lead) => {
        acc.total += 1;
        if (lead.status === "new") acc.new += 1;
        if (lead.status === "contacted") acc.contacted += 1;
        if (lead.status === "qualified") acc.qualified += 1;
        if (lead.status === "rejected") acc.rejected += 1;
        if (lead.temperature === "hot") acc.hot += 1;
        if (lead.temperature === "warm") acc.warm += 1;
        if (lead.temperature === "cold") acc.cold += 1;
        return acc;
      },
      {
        total: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        converted: 0,
        rejected: 0,
        hot: 0,
        warm: 0,
        cold: 0
      }
    );

    return res.json({
      team: {
        _id: team._id,
        name: team.name || "",
        teamLeadId: team.teamLeads?.[0]?.userId || null
      },
      range: selectedRange,
      member: mapUserForApi(user),
      target: targetProgress,
      deals: groupedDeals,
      leads,
      leadSummary,
      followups: followups.map(formatMemberFollowupRow)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load member detail" });
  }
};

exports.getTeamPipelineDetail = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can view pipeline details" });
    }

    const teamId = String(req.query?.teamId || "").trim();
    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }
    const pipelineType = String(req.query?.pipelineType || "deal").trim().toLowerCase() === "lead"
      ? "lead"
      : "deal";
    const stageOrder = pipelineType === "lead" ? LEAD_PIPELINE_STAGES : DEAL_PIPELINE_STAGES;
    const selectedRange = getTeamDashboardRange(req.query?.range);

    const team = await resolveTeamForDashboard(req.user, teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const leadIds = (team.teamLeads || []).map((lead) => String(lead.userId));
    const memberIds = (team.members || []).map((member) => String(member.userId));
    const allUserIds = [...new Set([...leadIds, ...memberIds])].filter(Boolean);

    if (!allUserIds.length) {
      const empty = buildEmptyPipeline(stageOrder);
      return res.json({
        team: {
          _id: team._id,
          name: team.name || "",
          totalPeople: 0
        },
        pipelineType,
        range: selectedRange,
        totals: empty.totals,
        stages: empty.stages.map((stage) => ({
          ...stage,
          deals: stage.items,
          leads: stage.items
        }))
      });
    }

    const memberObjectIds = allUserIds.map((id) => toObjectId(id));
    const usersMap = await loadUsersMap(allUserIds);

    if (pipelineType === "deal") {
      const deals = await Deal.find({
        assignedTo: { $in: memberObjectIds },
        is_deleted: { $ne: true },
        status: "open",
        stage: { $in: stageOrder },
        ...dateRangeMatch("createdAt", selectedRange)
      })
        .select(
          "_id assignedTo stage dealValue probability expectedCloseDate status updatedAt createdAt lead_id client_id"
        )
        .populate("lead_id", "company_name")
        .populate("client_id", "name")
        .sort({ stage: 1, updatedAt: -1, createdAt: -1 })
        .lean();

      const dealRows = (deals || []).map((deal) => ({
        _id: deal._id,
        stage: deal.stage || "",
        status: deal.status || "open",
        dealValue: Number(deal.dealValue || 0),
        probability: Number(deal.probability || 0),
        expectedCloseDate: deal.expectedCloseDate || null,
        updatedAt: deal.updatedAt || deal.createdAt || null,
        assignedTo: deal.assignedTo || null,
        companyName: deal.lead_id?.company_name || deal.client_id?.name || "Untitled Deal"
      }));
      const dealPipeline = summarizeDealPipeline(dealRows, usersMap, stageOrder);

      return res.json({
        team: {
          _id: team._id,
        name: team.name || "",
        totalPeople: allUserIds.length
      },
      pipelineType,
      range: selectedRange,
      totals: dealPipeline.totals,
        stages: dealPipeline.stages.map((stage) => ({
          ...stage,
          deals: stage.items
        }))
      });
    }

    const leadPipelineRaw = await Followup.find({
      assignedTo: { $in: memberObjectIds },
      is_deleted: { $ne: true },
      status: { $ne: "cancelled" },
      leadId: { $exists: true, $ne: null },
      ...dateRangeMatch("dueDateTime", selectedRange)
    })
      .select("leadId assignedTo stage status actionType title dueDateTime clientName updatedAt createdAt")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const latestLeadRows = [];
    const seenLeadIds = new Set();
    for (const row of leadPipelineRaw || []) {
      const leadId = String(row?.leadId || "");
      if (!leadId || seenLeadIds.has(leadId)) continue;
      seenLeadIds.add(leadId);
      latestLeadRows.push(row);
    }

    const leadIdsForLookup = latestLeadRows
      .map((row) => String(row?.leadId || ""))
      .filter(Boolean);
    const leadDocs = leadIdsForLookup.length
      ? await Lead.find(
          getActiveLeadMatch({
            _id: { $in: leadIdsForLookup }
          })
        )
          .select("company_name status lead_temperature deal_value_estimate")
          .lean()
      : [];
    const leadsMap = new Map(leadDocs.map((lead) => [String(lead._id), lead]));
    const leadPipeline = summarizeLeadPipeline({
      leadFollowups: latestLeadRows,
      usersMap,
      leadsMap,
      stageOrder
    });

    return res.json({
      team: {
        _id: team._id,
      name: team.name || "",
      totalPeople: allUserIds.length
    },
    pipelineType,
    range: selectedRange,
    totals: leadPipeline.totals,
      stages: leadPipeline.stages.map((stage) => ({
        ...stage,
        leads: stage.items
      }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load pipeline details" });
  }
};

exports.getTeamTargets = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can view team targets" });
    }

    const teamId = String(req.query?.teamId || "").trim();
    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }

    const team = await Team.findById(teamId).lean();
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "Only team lead or admin can view team targets" });
    }

    const { periodType, periodStart, periodEnd } = getPeriodRange(
      req.query?.periodType,
      req.query?.periodStart
    );

    const memberIds = (team.members || [])
      .map((member) => String(member.userId || ""))
      .filter((id) => isObjectId(id));
    const teamLeadIds = (team.teamLeads || [])
      .map((lead) => String(lead.userId || ""))
      .filter((id) => isObjectId(id));
    const teamUserIds = [...new Set([...teamLeadIds, ...memberIds])];
    const assignableUserIds = teamUserIds;
    const assignableUserObjectIds = assignableUserIds.map((id) => toObjectId(id));
    const teamUserObjectIds = teamUserIds.map((id) => toObjectId(id));

    const usersMap = await loadUsersMap(teamUserIds);
    const [teamTargetDoc, targetDocs, achievedAgg] = await Promise.all([
      SalesTarget.findOne({
        scope_type: "team",
        team_id: team._id,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        status: { $ne: "archived" }
      })
        .sort({ updated_at: -1, created_at: -1 })
        .lean(),
      assignableUserObjectIds.length
        ? SalesTarget.find({
            user_id: { $in: assignableUserObjectIds },
            team_id: team._id,
            period_type: periodType,
            period_start: periodStart,
            period_end: periodEnd,
            $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }],
            status: { $ne: "archived" }
          })
            .sort({ updated_at: -1, created_at: -1 })
            .lean()
        : [],
      teamUserObjectIds.length
        ? Deal.aggregate([
            {
              $match: {
                assignedTo: { $in: teamUserObjectIds },
                status: "won",
                is_deleted: { $ne: true }
              }
            },
            {
              $addFields: {
                closedAt: { $ifNull: ["$actualCloseDate", "$updatedAt"] }
              }
            },
            {
              $match: {
                closedAt: { $gte: periodStart, $lte: periodEnd }
              }
            },
            {
              $group: {
                _id: "$assignedTo",
                achievedRevenue: { $sum: { $ifNull: ["$dealValue", 0] } },
                achievedDeals: { $sum: 1 }
              }
            }
          ])
        : []
    ]);

    const safeTargetDocs = Array.isArray(targetDocs) ? targetDocs : [];
    const safeAchievedAgg = Array.isArray(achievedAgg) ? achievedAgg : [];

    const targetMap = new Map();
    for (const doc of safeTargetDocs) {
      const userId = String(doc.user_id || "");
      if (!userId || targetMap.has(userId)) continue;
      targetMap.set(userId, doc);
    }

    const achievementMap = new Map();
    let teamAchievedRevenue = 0;
    let teamAchievedDeals = 0;

    for (const row of safeAchievedAgg) {
      const userId = String(row?._id || "");
      if (!userId) continue;

      const achievedRevenue = Number(row?.achievedRevenue || 0);
      const achievedDeals = Number(row?.achievedDeals || 0);
      achievementMap.set(userId, { achievedRevenue, achievedDeals });
      teamAchievedRevenue += achievedRevenue;
      teamAchievedDeals += achievedDeals;
    }

    const members = assignableUserIds
      .map((userId) => {
        const user = usersMap.get(userId);
        if (!user) return null;
        const target = targetMap.get(userId);
        const achieved = achievementMap.get(userId) || {
          achievedRevenue: 0,
          achievedDeals: 0
        };
        const assignedRevenue = Number(target?.revenue_target || 0);
        const assignedDeals = Number(target?.deal_target || 0);
        const revenueProgress = assignedRevenue
          ? Math.min(100, Math.round((achieved.achievedRevenue / assignedRevenue) * 100))
          : 0;
        const dealsProgress = assignedDeals
          ? Math.min(100, Math.round((achieved.achievedDeals / assignedDeals) * 100))
          : 0;

        return {
          user: mapUserForApi(user),
          targetId: target?._id || null,
          revenueTarget: assignedRevenue,
          dealTarget: assignedDeals,
          followupTarget: Number(target?.followup_target || 0),
          winRateTarget: Number(target?.win_rate_target || 0),
          pipelineTarget: Number(target?.pipeline_target || 0),
          stretchRevenueTarget: Number(target?.stretch_revenue_target || 0),
          bonusPercent: Number(target?.Bonus_percent || 0),
          notes: target?.notes || "",
          achievedRevenue: achieved.achievedRevenue,
          achievedDeals: achieved.achievedDeals,
          revenueProgress,
          dealsProgress
        };
      })
      .filter(Boolean);

    const teamAssignedRevenue = Number(teamTargetDoc?.revenue_target || 0);
    const teamAssignedDeals = Number(teamTargetDoc?.deal_target || 0);
    const teamRevenueProgress = teamAssignedRevenue
      ? Math.min(100, Math.round((teamAchievedRevenue / teamAssignedRevenue) * 100))
      : 0;
    const teamDealsProgress = teamAssignedDeals
      ? Math.min(100, Math.round((teamAchievedDeals / teamAssignedDeals) * 100))
      : 0;

    const teamLead = usersMap.get(String(teamLeadIds[0] || "")) || null;

    return res.json({
      team: {
        _id: team._id,
        name: team.name || "",
        lead: teamLead ? mapUserForApi(teamLead) : null,
        memberCount: memberIds.length
      },
      period: {
        periodType,
        periodStart,
        periodEnd
      },
      teamTarget: {
        revenueTarget: teamAssignedRevenue,
        dealTarget: teamAssignedDeals,
        notes: teamTargetDoc?.notes || "",
        achievedRevenue: teamAchievedRevenue,
        achievedDeals: teamAchievedDeals,
        revenueProgress: teamRevenueProgress,
        dealsProgress: teamDealsProgress,
        updatedAt: teamTargetDoc?.updated_at || teamTargetDoc?.created_at || null
      },
      members
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load team targets" });
  }
};

exports.upsertTeamTargets = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!isAdmin(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can assign targets" });
    }

    const teamId = String(req.body?.teamId || "").trim();
    if (!isObjectId(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }

    const team = await Team.findById(teamId).lean();
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "Only team lead or admin can assign targets" });
    }

    const { periodType, periodStart, periodEnd } = getPeriodRange(
      req.body?.periodType,
      req.body?.periodStart
    );

    const now = new Date();

    if (isAdmin(req.user.role)) {
      const teamTarget = req.body?.teamTarget || {};
      const revenueTarget = sanitizeTargetNumber(teamTarget?.revenueTarget, -1);
      const dealTarget = sanitizeTargetNumber(teamTarget?.dealTarget, -1);
      const notes = String(teamTarget?.notes || "").trim();

      if (revenueTarget < 0 || dealTarget < 0) {
        return res.status(400).json({
          message: "Admin must provide team revenue and deal target"
        });
      }

      await SalesTarget.updateOne(
        {
          scope_type: "team",
          team_id: team._id,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd
        },
        {
          $set: {
            scope_type: "team",
            user_id: null,
            team_id: team._id,
            period_type: periodType,
            period_start: periodStart,
            period_end: periodEnd,
            revenue_target: revenueTarget,
            deal_target: dealTarget,
            notes,
            assigned_by: req.user._id,
            status: "active",
            updated_at: now
          },
          $setOnInsert: {
            created_at: now,
            w: {}
          }
        },
        { upsert: true }
      );

      return res.json({
        message: "Team target saved successfully"
      });
    }

    if (!canManageTeam(team, req.user)) {
      return res.status(403).json({ message: "Only team lead can assign user targets" });
    }

    const memberIds = (team.members || [])
      .map((member) => String(member.userId || ""))
      .filter((id) => isObjectId(id));
    const teamLeadIds = (team.teamLeads || [])
      .map((lead) => String(lead.userId || ""))
      .filter((id) => isObjectId(id));
    const assignableUserIds = new Set([...teamLeadIds, ...memberIds]);

    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    if (!targets.length) {
      return res.status(400).json({ message: "At least one member target is required" });
    }

    const ops = [];

    for (const row of targets) {
      const userId = String(row?.userId || "").trim();
      if (!isObjectId(userId) || !assignableUserIds.has(userId)) continue;

      const updateDoc = {
        scope_type: "user",
        user_id: toObjectId(userId),
        team_id: team._id,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        revenue_target: sanitizeTargetNumber(row?.revenueTarget, 0),
        deal_target: sanitizeTargetNumber(row?.dealTarget, 0),
        notes: String(row?.notes || "").trim(),
        assigned_by: req.user._id,
        status: "active",
        updated_at: now
      };

      ops.push({
        updateOne: {
          filter: {
            user_id: toObjectId(userId),
            team_id: team._id,
            period_type: periodType,
            period_start: periodStart,
            period_end: periodEnd,
            $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }]
          },
          update: {
            $set: updateDoc,
            $setOnInsert: {
              created_at: now,
              w: {}
            }
          },
          upsert: true
        }
      });
    }

    if (!ops.length) {
      return res.status(400).json({ message: "No valid member targets found in payload" });
    }

    await SalesTarget.bulkWrite(ops, { ordered: false });

    return res.json({
      message: "Member targets saved successfully",
      updatedCount: ops.length
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to save team targets" });
  }
};
