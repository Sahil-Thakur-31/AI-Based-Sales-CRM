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

function buildInsights({ winRate, followupsToday, activeDeals, memberPerformance }) {
  const insights = [];

  if (activeDeals === 0) {
    insights.push({
      type: "pipeline",
      severity: "high",
      message: "No active deals in the current team pipeline."
    });
  } else if (winRate < 30) {
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

async function resolveTeamForDashboard(requester, teamId) {
  const query = {};

  if (!isAdmin(requester.role)) {
    query.$or = [
      { "teamLeads.userId": requester._id },
      { members: { $elemMatch: { userId: requester._id } } }
    ];
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
      : {
          $or: [
            { "teamLeads.userId": req.user._id },
            { members: { $elemMatch: { userId: req.user._id } } }
          ]
        };

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

    team.members.push({ userId });
    await team.save();

    return res.json({ message: "Member added successfully" });
  } catch (err) {
    console.error(err);
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
        teamLeads,
        members,
        kpis: {
          followupsToday: 0,
          activeDeals: 0,
          pipelineValue: 0,
          winRate: 0,
          wonRevenue: 0,
          closedDeals: 0
        },
        followups: [],
        stageDistribution: [],
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
      is_deleted: { $ne: true }
    };

    const [dealStatusAgg, stageAgg, memberDealAgg] = await Promise.all([
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
        {
          $match: {
            ...dealsMatch,
            status: "open",
            stage: { $in: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] }
          }
        },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
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
      ])
    ]);

    const dealStatusMap = new Map(dealStatusAgg.map((item) => [String(item._id), item]));
    const openDeals = dealStatusMap.get("open")?.count || 0;
    const wonDeals = dealStatusMap.get("won")?.count || 0;
    const lostDeals = dealStatusMap.get("lost")?.count || 0;
    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals ? Math.round((wonDeals / closedDeals) * 100) : 0;
    const pipelineValue = dealStatusMap.get("open")?.value || 0;
    const wonRevenue = dealStatusMap.get("won")?.value || 0;

    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [followupsToday, followupRows, followupByMemberAgg] = await Promise.all([
      Lead.countDocuments({
        assigned_to: { $in: memberObjectIds },
        last_contact_date: { $gte: today, $lt: tomorrow },
        is_deleted: { $ne: true }
      }),
      Lead.find({
        assigned_to: { $in: memberObjectIds },
        last_contact_date: { $gte: today, $lt: tomorrow },
        is_deleted: { $ne: true }
      })
        .sort({ last_contact_date: 1 })
        .select("company_name message next_action last_contact_date lead_temperature assigned_to")
        .populate("assigned_to", "name email")
        .lean(),
      Lead.aggregate([
        {
          $match: {
            assigned_to: { $in: memberObjectIds },
            last_contact_date: { $gte: today, $lt: tomorrow },
            is_deleted: { $ne: true }
          }
        },
        {
          $group: {
            _id: "$assigned_to",
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const followupByMemberMap = new Map(
      followupByMemberAgg.map((item) => [String(item._id), item.count])
    );

    const memberDealMap = new Map(
      memberDealAgg.map((item) => [String(item._id), item])
    );

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

        const userClosed = (perf.wonDeals || 0) + (perf.lostDeals || 0);
        const userWinRate = userClosed ? Math.round(((perf.wonDeals || 0) / userClosed) * 100) : 0;

        return {
          user: mapUserForApi(user),
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
      .sort((a, b) => b.wonRevenue - a.wonRevenue || b.pipelineValue - a.pipelineValue);

    const followups = followupRows.map((lead) => ({
      _id: lead._id,
      companyName: lead.company_name || "Unknown company",
      message: lead.message || "",
      nextAction: lead.next_action || "",
      temperature: lead.lead_temperature || "cold",
      lastContactDate: lead.last_contact_date || null,
      assignedTo: lead.assigned_to
        ? {
            _id: lead.assigned_to._id,
            name: lead.assigned_to.name || "Unknown",
            email: lead.assigned_to.email || ""
          }
        : null
    }));

    const stageDistribution = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"].map((stage) => {
      const entry = stageAgg.find((item) => item._id === stage);
      return {
        stage,
        count: entry?.count || 0
      };
    });

    const insights = buildInsights({
      winRate,
      followupsToday,
      activeDeals: openDeals,
      memberPerformance
    });

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
      kpis: {
        followupsToday,
        activeDeals: openDeals,
        pipelineValue,
        winRate,
        wonRevenue,
        closedDeals
      },
      followups,
      stageDistribution,
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
    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const now = new Date();

    const [deals, followups, activeTargetDoc] = await Promise.all([
      Deal.find({
        assignedTo: memberObjectId,
        is_deleted: { $ne: true },
        status: { $in: ["open", "won", "lost"] }
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
        dueDateTime: { $gte: today, $lt: tomorrow }
      })
        .select(
          "title clientName kind actionType leadId dealId clientId stage priority dueDateTime status completedAt"
        )
        .sort({ dueDateTime: 1, createdAt: 1 })
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

    return res.json({
      team: {
        _id: team._id,
        name: team.name || "",
        teamLeadId: team.teamLeads?.[0]?.userId || null
      },
      member: mapUserForApi(user),
      target: targetProgress,
      deals: groupedDeals,
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

    const team = await resolveTeamForDashboard(req.user, teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const leadIds = (team.teamLeads || []).map((lead) => String(lead.userId));
    const memberIds = (team.members || []).map((member) => String(member.userId));
    const allUserIds = [...new Set([...leadIds, ...memberIds])].filter(Boolean);

    const stageOrder = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
    if (!allUserIds.length) {
      return res.json({
        team: {
          _id: team._id,
          name: team.name || "",
          totalPeople: 0
        },
        totals: {
          count: 0,
          value: 0
        },
        stages: stageOrder.map((stage) => ({
          stage,
          count: 0,
          value: 0,
          deals: []
        }))
      });
    }

    const memberObjectIds = allUserIds.map((id) => toObjectId(id));
    const usersMap = await loadUsersMap(allUserIds);

    const deals = await Deal.find({
      assignedTo: { $in: memberObjectIds },
      is_deleted: { $ne: true },
      status: "open",
      stage: { $in: stageOrder }
    })
      .select(
        "_id assignedTo stage dealValue probability expectedCloseDate actualCloseDate status updatedAt createdAt lead_id client_id"
      )
      .sort({ stage: 1, updatedAt: -1, createdAt: -1 })
      .lean();

    const leadIdList = [
      ...new Set(
        deals
          .map((deal) => (deal.lead_id ? String(deal.lead_id) : ""))
          .filter(Boolean)
      )
    ];
    const clientIdList = [
      ...new Set(
        deals
          .map((deal) => (deal.client_id ? String(deal.client_id) : ""))
          .filter(Boolean)
      )
    ];

    const [leadDocs, clientDocs] = await Promise.all([
      leadIdList.length ? Lead.find({ _id: { $in: leadIdList } }).select("company_name").lean() : [],
      clientIdList.length ? Client.find({ _id: { $in: clientIdList } }).select("name").lean() : []
    ]);

    const leadMap = new Map(leadDocs.map((lead) => [String(lead._id), lead]));
    const clientMap = new Map(clientDocs.map((client) => [String(client._id), client]));

    const stageMap = new Map(
      stageOrder.map((stage) => [
        stage,
        {
          stage,
          count: 0,
          value: 0,
          deals: []
        }
      ])
    );

    let totalCount = 0;
    let totalValue = 0;

    for (const deal of deals) {
      const stageKey = stageOrder.includes(deal.stage) ? deal.stage : null;
      if (!stageKey) continue;

      const stageEntry = stageMap.get(stageKey);
      if (!stageEntry) continue;

      const dealValue = Number(deal.dealValue) || 0;
      const assignedUser = usersMap.get(String(deal.assignedTo || ""));
      const lead = leadMap.get(String(deal.lead_id || ""));
      const client = clientMap.get(String(deal.client_id || ""));

      stageEntry.count += 1;
      stageEntry.value += dealValue;
      stageEntry.deals.push({
        _id: deal._id,
        companyName: lead?.company_name || client?.name || "Untitled Deal",
        stage: deal.stage || "",
        status: deal.status || "open",
        dealValue,
        probability: Number(deal.probability) || 0,
        expectedCloseDate: deal.expectedCloseDate || null,
        updatedAt: deal.updatedAt || deal.createdAt || null,
        assignedTo: assignedUser ? mapUserForApi(assignedUser) : null
      });

      totalCount += 1;
      totalValue += dealValue;
    }

    return res.json({
      team: {
        _id: team._id,
        name: team.name || "",
        totalPeople: allUserIds.length
      },
      totals: {
        count: totalCount,
        value: totalValue
      },
      stages: stageOrder.map((stage) => stageMap.get(stage))
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
    const memberObjectIds = memberIds.map((id) => toObjectId(id));
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
      memberObjectIds.length
        ? SalesTarget.find({
            user_id: { $in: memberObjectIds },
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

    const members = memberIds
      .map((memberId) => {
        const user = usersMap.get(memberId);
        if (!user) return null;
        const target = targetMap.get(memberId);
        const achieved = achievementMap.get(memberId) || {
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

    const memberIds = new Set(
      (team.members || [])
        .map((member) => String(member.userId || ""))
        .filter((id) => isObjectId(id))
    );

    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    if (!targets.length) {
      return res.status(400).json({ message: "At least one member target is required" });
    }

    const ops = [];

    for (const row of targets) {
      const userId = String(row?.userId || "").trim();
      if (!isObjectId(userId) || !memberIds.has(userId)) continue;

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
