const mongoose = require("mongoose");
const Team = require("../models/teams");
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const User = require("../models/users");

const ADMIN_ROLE = "Admin";
const MANAGER_ROLE = "Manager";

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

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Team name is required" });
    }

    if (!selectedLeadId) {
      return res.status(400).json({ message: "A team lead is required" });
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
      name: String(name).trim(),
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
