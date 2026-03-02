const mongoose = require("mongoose");
const Team = require("../models/teams");
const Deal = require("../models/deals");
const Followup = require("../models/followUp");
const User = require("../models/users");

function normalizeRole(value = "") {
  return String(value).trim().toLowerCase();
}

function isAdmin(req) {
  return normalizeRole(req.user?.role) === "admin";
}

function isManager(req) {
  return normalizeRole(req.user?.role) === "manager";
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function toObjectId(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function uniqObjectIds(values = []) {
  if (!Array.isArray(values)) return [];
  const ids = values
    .map((v) => String(v || "").trim())
    .filter((v) => isObjectId(v));
  return [...new Set(ids)].map((v) => toObjectId(v));
}

function getRoleNameFromUser(user) {
  return String(user?.role?.name || user?.roleName || "").trim();
}

function mapUserMini(user) {
  return {
    _id: user?._id || null,
    name: user?.name || "Unknown",
    email: user?.email || "",
    roleName: getRoleNameFromUser(user)
  };
}

function modeFromActionType(actionType) {
  const raw = String(actionType || "").trim().toLowerCase();
  if (!raw) return "Phone Call";
  if (
    raw.includes("physical") ||
    raw.includes("visit") ||
    raw.includes("offline") ||
    raw.includes("in-person") ||
    raw.includes("inperson")
  ) {
    return "Physical";
  }
  if (
    raw.includes("online") ||
    raw.includes("virtual") ||
    raw.includes("zoom") ||
    raw.includes("meet") ||
    raw.includes("video") ||
    raw.includes("email")
  ) {
    return "Online";
  }
  if (raw.includes("call") || raw.includes("phone")) {
    return "Phone Call";
  }
  return "Phone Call";
}

function entityFromFollowup(doc) {
  return doc?.leadId ? "Lead" : "Deal";
}

function canManageTeam(req, team) {
  if (!req.user?._id || !team) return false;
  if (isAdmin(req)) return true;
  if (!isManager(req)) return false;
  return (team.teamLeads || []).some((lead) => String(lead.userId) === String(req.user._id));
}

function buildTeamResponse(teamDoc) {
  const leads = (teamDoc.teamLeads || []).map((lead) => ({ userId: mapUserMini(lead.userId) }));
  const members = (teamDoc.members || []).map((member) => ({ userId: mapUserMini(member.userId) }));
  return {
    _id: teamDoc._id,
    name: teamDoc.name || "",
    createdAt: teamDoc.createdAt || null,
    updatedAt: teamDoc.updatedAt || null,
    teamLeads: leads,
    members,
    leadCount: leads.length,
    memberCount: members.length,
    totalPeople: leads.length + members.length
  };
}

exports.createTeam = async (req, res) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
    if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can create teams" });

    const name = String(req.body?.name || "").trim();
    const teamLeadIds = uniqObjectIds(req.body?.teamLeadIds || []);
    const teamLeadId = isObjectId(req.body?.teamLeadId) ? toObjectId(req.body.teamLeadId) : null;
    const members = uniqObjectIds(req.body?.members || []);

    const selectedLeadId = teamLeadId || teamLeadIds[0] || null;

    if (!name) return res.status(400).json({ message: "Team name is required" });
    if (!selectedLeadId) return res.status(400).json({ message: "A team lead is required" });
    if (teamLeadIds.length > 1) {
      return res.status(400).json({ message: "Only one team lead is allowed" });
    }

    const leadUser = await User.findOne({
      _id: selectedLeadId,
      is_deleted: { $ne: true },
      is_active: true
    })
      .populate("role", "name")
      .lean();

    if (!leadUser) {
      return res.status(400).json({ message: "Selected team lead is invalid" });
    }
    if (normalizeRole(getRoleNameFromUser(leadUser)) !== "manager") {
      return res.status(400).json({ message: "Team lead must be a Manager" });
    }

    const memberUsers = members.length
      ? await User.find({
          _id: { $in: members },
          is_deleted: { $ne: true },
          is_active: true
        })
          .populate("role", "name")
          .lean()
      : [];

    if (memberUsers.length !== members.length) {
      return res.status(400).json({ message: "One or more selected members are invalid" });
    }

    const hasAdminMember = memberUsers.some(
      (user) => normalizeRole(getRoleNameFromUser(user)) === "admin"
    );
    if (hasAdminMember) {
      return res.status(400).json({ message: "Admin users cannot be team members" });
    }

    const filteredMembers = members.filter((id) => String(id) !== String(selectedLeadId));

    const team = await Team.create({
      name,
      teamLeads: [{ userId: selectedLeadId }],
      members: filteredMembers.map((id) => ({ userId: id })),
      createdBy: req.user._id
    });

    const created = await Team.findById(team._id)
      .populate("teamLeads.userId", "name email role")
      .populate("members.userId", "name email role");

    return res.status(201).json(buildTeamResponse(created));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to create team" });
  }
};

exports.listTeams = async (req, res) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
    if (!isAdmin(req) && !isManager(req)) return res.status(403).json({ message: "Access denied" });

    const filter = isAdmin(req)
      ? {}
      : {
          $or: [
            { "teamLeads.userId": req.user._id },
            { "members.userId": req.user._id }
          ]
        };

    const teams = await Team.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate("teamLeads.userId", "name email role")
      .populate("members.userId", "name email role");

    return res.json(teams.map(buildTeamResponse));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch teams" });
  }
};

exports.addMember = async (req, res) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
    const { teamId, userId } = req.body || {};
    if (!isObjectId(teamId) || !isObjectId(userId)) {
      return res.status(400).json({ message: "Valid teamId and userId are required" });
    }

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ message: "Team not found" });
    if (!canManageTeam(req, team)) {
      return res.status(403).json({ message: "You are not allowed to modify this team" });
    }

    const user = await User.findOne({
      _id: userId,
      is_deleted: { $ne: true },
      is_active: true
    })
      .populate("role", "name")
      .lean();

    if (!user) return res.status(404).json({ message: "User not found or inactive" });
    if (normalizeRole(getRoleNameFromUser(user)) === "admin") {
      return res.status(400).json({ message: "Admin users cannot be team members" });
    }

    const alreadyInLeads = (team.teamLeads || []).some((lead) => String(lead.userId) === String(userId));
    const alreadyInMembers = (team.members || []).some((member) => String(member.userId) === String(userId));
    if (alreadyInLeads || alreadyInMembers) {
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
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
    const { teamId, userId } = req.body || {};
    if (!isObjectId(teamId) || !isObjectId(userId)) {
      return res.status(400).json({ message: "Valid teamId and userId are required" });
    }

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ message: "Team not found" });
    if (!canManageTeam(req, team)) {
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
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
    if (!isAdmin(req) && !isManager(req)) {
      return res.status(403).json({ message: "Only managers and admins can view team dashboard" });
    }

    const requestedTeamId = req.query?.teamId;
    let team;

    if (requestedTeamId && !isObjectId(requestedTeamId)) {
      return res.status(400).json({ message: "Invalid teamId" });
    }

    if (isAdmin(req)) {
      const adminFilter = requestedTeamId ? { _id: requestedTeamId } : {};
      team = await Team.findOne(adminFilter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .populate("teamLeads.userId", "name email role")
        .populate("members.userId", "name email role");
    } else {
      const managerFilter = {
        ...(requestedTeamId ? { _id: requestedTeamId } : {}),
        $or: [{ "teamLeads.userId": req.user._id }, { "members.userId": req.user._id }]
      };
      team = await Team.findOne(managerFilter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .populate("teamLeads.userId", "name email role")
        .populate("members.userId", "name email role");
    }

    if (!team) return res.status(404).json({ message: "Team not found" });

    const leadIds = (team.teamLeads || []).map((lead) => String(lead.userId?._id || lead.userId)).filter(Boolean);
    const memberIds = (team.members || []).map((member) => String(member.userId?._id || member.userId)).filter(Boolean);
    const allUserIds = [...new Set([...leadIds, ...memberIds])];

    const teamLeads = (team.teamLeads || [])
      .map((lead) => lead.userId)
      .filter(Boolean)
      .map(mapUserMini);

    const members = (team.members || [])
      .map((member) => member.userId)
      .filter(Boolean)
      .map(mapUserMini);

    if (!allUserIds.length) {
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
          followupsToday: 0,
          activeDeals: 0,
          pipelineValue: 0,
          winRate: 0,
          wonRevenue: 0,
          closedDeals: 0
        },
        followups: [],
        stageDistribution: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"].map((stage) => ({ stage, count: 0 })),
        memberPerformance: [],
        insights: [{ type: "team", message: "No users are assigned to this team yet." }]
      });
    }

    const memberObjectIds = allUserIds.map((id) => toObjectId(id));
    const dealsMatch = { assignedTo: { $in: memberObjectIds }, is_deleted: { $ne: true } };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const followupTodayMatch = {
      assignedTo: { $in: memberObjectIds },
      is_deleted: false,
      dueDateTime: { $gte: today, $lt: tomorrow },
      status: { $nin: ["completed", "cancelled"] }
    };

    const [dealStatusAgg, stageAgg, memberDealAgg, followupsToday, followupRows, followupByMemberAgg] =
      await Promise.all([
        Deal.aggregate([
          { $match: dealsMatch },
          { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: { $ifNull: ["$dealValue", 0] } } } }
        ]),
        Deal.aggregate([
          {
            $match: {
              ...dealsMatch,
              status: "open",
              stage: { $in: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] }
            }
          },
          { $group: { _id: "$stage", count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]),
        Deal.aggregate([
          { $match: dealsMatch },
          {
            $group: {
              _id: "$assignedTo",
              openDeals: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
              wonDeals: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
              lostDeals: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
              pipelineValue: {
                $sum: { $cond: [{ $eq: ["$status", "open"] }, { $ifNull: ["$dealValue", 0] }, 0] }
              },
              wonRevenue: {
                $sum: { $cond: [{ $eq: ["$status", "won"] }, { $ifNull: ["$dealValue", 0] }, 0] }
              }
            }
          }
        ]),
        Followup.countDocuments(followupTodayMatch),
        Followup.find(followupTodayMatch)
          .sort({ dueDateTime: 1, createdAt: -1 })
          .select("title actionType dueDateTime priority status assignedTo leadId clientId contactId")
          .populate("assignedTo", "name email")
          .lean(),
        Followup.aggregate([
          { $match: followupTodayMatch },
          { $group: { _id: "$assignedTo", count: { $sum: 1 } } }
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

    const followupByMemberMap = new Map(followupByMemberAgg.map((item) => [String(item._id), item.count]));
    const memberDealMap = new Map(memberDealAgg.map((item) => [String(item._id), item]));

    const users = await User.find({ _id: { $in: memberObjectIds }, is_deleted: { $ne: true } })
      .populate("role", "name")
      .select("name email role")
      .lean();
    const usersMap = new Map(users.map((user) => [String(user._id), user]));

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

        const closed = (perf.wonDeals || 0) + (perf.lostDeals || 0);
        const memberWinRate = closed ? Math.round(((perf.wonDeals || 0) / closed) * 100) : 0;

        return {
          user: mapUserMini(user),
          openDeals: perf.openDeals || 0,
          wonDeals: perf.wonDeals || 0,
          lostDeals: perf.lostDeals || 0,
          followupsToday: followupByMemberMap.get(String(userId)) || 0,
          winRate: memberWinRate,
          pipelineValue: perf.pipelineValue || 0,
          wonRevenue: perf.wonRevenue || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.wonRevenue - a.wonRevenue || b.pipelineValue - a.pipelineValue);

    const followups = followupRows.map((item) => ({
      _id: item._id,
      title: item.title || "Untitled Follow-up",
      assignedTo: item.assignedTo
        ? { _id: item.assignedTo._id, name: item.assignedTo.name || "Unknown", email: item.assignedTo.email || "" }
        : null,
      dueDateTime: item.dueDateTime || null,
      modeTag: modeFromActionType(item.actionType),
      entityTag: entityFromFollowup(item),
      status: item.status || "pending",
      priority: item.priority || "medium"
    }));

    const stageDistribution = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"].map((stage) => {
      const match = stageAgg.find((row) => row._id === stage);
      return { stage, count: match?.count || 0 };
    });

    const insights = [];
    if (openDeals === 0) insights.push({ type: "pipeline", message: "No active deals in the current team pipeline." });
    if (followupsToday === 0) insights.push({ type: "followups", message: "No follow-ups due today." });
    if (!insights.length) insights.push({ type: "summary", message: "Team activity is stable for today." });

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
