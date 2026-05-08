//Purpose: All MongoDB aggregation + formatting to match frontend response shapes.
//Uses your models:


// backend/services/adminDashboardservice.js
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Followup = require("../models/followUp");
const User = require("../models/users");
const Team = require("../models/teams");
const Role = require("../models/roles");

// Optional model - if file exists in your models folder
let AiGeneratedLeads = null;
try {
  AiGeneratedLeads = require("../models/ai_generated_leads");
} catch (e) {
  AiGeneratedLeads = null;
}

const { getRangeDates } = require("./dashboardRange.admin");

async function getNonAdminUserIds() {
  const adminRoles = await Role.find(
    {
      is_deleted: { $ne: true },
      name: { $regex: /^admin$/i }
    },
    { _id: 1 }
  ).lean();

  const adminRoleIds = adminRoles.map((role) => role._id).filter(Boolean);
  const users = await User.find(
    {
      is_deleted: { $ne: true },
      is_active: { $ne: false },
      ...(adminRoleIds.length ? { role: { $nin: adminRoleIds } } : {})
    },
    { _id: 1 }
  ).lean();

  return users.map((user) => user._id).filter(Boolean);
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

function riskLabelFromAi(aiRiskScore) {
  const s = Number(aiRiskScore);
  if (!Number.isFinite(s)) return "medium";
  if (s <= 33) return "low";
  if (s <= 66) return "medium";
  return "high";
}

function iconFromActionType(actionType = "") {
  const a = String(actionType).toLowerCase();
  if (a.includes("call")) return "📞";
  if (a.includes("email")) return "✉️";
  if (a.includes("meeting") || a.includes("demo")) return "🤝";
  if (a.includes("doc") || a.includes("contract")) return "📄";
  return "🔔";
}

/**
 * SUMMARY
 * Shape must match frontend:
 * {
 *  revenueWon, revenueDeltaPct,
 *  activeDeals, activeDealsDelta,
 *  winRatePct, winRateDeltaPct,
 *  pipelineValue, pipelineDeltaPct,
 *  openLeads, openLeadsFromAI
 * }
 */
async function getSummary(range) {
  const { start, end, prevStart, prevEnd } = getRangeDates(range);
  const nonAdminUserIds = await getNonAdminUserIds();

  // Won revenue in current range
  const wonAgg = await Deal.aggregate([
    { $match: { status: "won", is_deleted: { $ne: true }, assignedTo: { $in: nonAdminUserIds }, actualCloseDate: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenueWon = wonAgg[0]?.total || 0;

  // Won revenue in previous range
  const prevWonAgg = await Deal.aggregate([
    { $match: { status: "won", is_deleted: { $ne: true }, assignedTo: { $in: nonAdminUserIds }, actualCloseDate: { $gte: prevStart, $lte: prevEnd } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenuePrev = prevWonAgg[0]?.total || 0;

  // Active deals created in the selected range.
  const activeDeals = await Deal.countDocuments({
    status: "open",
    is_deleted: { $ne: true },
    assignedTo: { $in: nonAdminUserIds },
    createdAt: { $gte: start, $lte: end },
  });

  // Compare against the previous equivalent range window.
  const activeDealsPrev = await Deal.countDocuments({
    status: "open",
    is_deleted: { $ne: true },
    assignedTo: { $in: nonAdminUserIds },
    createdAt: { $gte: prevStart, $lte: prevEnd },
  });

  // Win rate (won / (won+lost)) in this range based on actualCloseDate
  const closedAgg = await Deal.aggregate([
    {
      $match: {
        is_deleted: { $ne: true },
        status: { $in: ["won", "lost"] },
        assignedTo: { $in: nonAdminUserIds },
        actualCloseDate: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);
  const wonCount = closedAgg.find((x) => x._id === "won")?.c || 0;
  const lostCount = closedAgg.find((x) => x._id === "lost")?.c || 0;
  const totalClosed = wonCount + lostCount;
  const winRatePct = totalClosed === 0 ? 0 : Math.round((wonCount / totalClosed) * 100);

  const prevClosedAgg = await Deal.aggregate([
    {
      $match: {
        is_deleted: { $ne: true },
        status: { $in: ["won", "lost"] },
        assignedTo: { $in: nonAdminUserIds },
        actualCloseDate: { $gte: prevStart, $lte: prevEnd },
      },
    },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);
  const prevWonCount = prevClosedAgg.find((x) => x._id === "won")?.c || 0;
  const prevLostCount = prevClosedAgg.find((x) => x._id === "lost")?.c || 0;
  const prevTotalClosed = prevWonCount + prevLostCount;
  const prevWinRate = prevTotalClosed === 0 ? 0 : Math.round((prevWonCount / prevTotalClosed) * 100);

  // Pipeline value within the selected range.
  const pipeAgg = await Deal.aggregate([
    {
      $match: {
        status: "open",
        is_deleted: { $ne: true },
        assignedTo: { $in: nonAdminUserIds },
        createdAt: { $gte: start, $lte: end },
      }
    },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const pipelineValue = pipeAgg[0]?.total || 0;

  // (Optional) pipeline vs target
  // For now: keep 0 to avoid wrong info until target logic is final.
  const pipelineDeltaPct = 0;

  // Open leads created in the selected range and still open.
  const openLeads = await Lead.countDocuments({
    is_active: true,
    is_deleted: { $ne: true },
    assigned_to: { $in: nonAdminUserIds },
    status: { $nin: ["converted", "rejected"] },
    created_at: { $gte: start, $lte: end },
  });

  // AI-sourced leads created in this range (if model exists)
  let openLeadsFromAI = 0;
  if (AiGeneratedLeads) {
    openLeadsFromAI = await AiGeneratedLeads.countDocuments({
      is_active: true,
      created_at: { $gte: start, $lte: end },
      generated_by: { $in: nonAdminUserIds },
      status: { $in: ["new", "reviewed"] },
    });
  }

  return {
    revenueWon,
    revenueDeltaPct: pctChange(revenueWon, revenuePrev),

    activeDeals,
    activeDealsDelta: activeDeals - activeDealsPrev,

    winRatePct,
    winRateDeltaPct: winRatePct - prevWinRate,

    pipelineValue,
    pipelineDeltaPct,

    openLeads,
    openLeadsFromAI,
  };
}

/**
 * PIPELINE
 * Shape must match frontend:
 * [{ code, label, count, amount }, ...]
 */
async function getPipeline(range, pipelineType = "deal") {
  const { start, end } = getRangeDates(range);
  const normalizedType = String(pipelineType || "deal").toLowerCase() === "lead" ? "lead" : "deal";
  const nonAdminUserIds = await getNonAdminUserIds();
  const stages = normalizedType === "deal"
    ? ["P1", "P2", "P3", "P6", "P7"]
    : ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];

  const agg =
    normalizedType === "lead"
      ? await Lead.aggregate([
          {
            $match: {
              is_deleted: { $ne: true },
              is_active: true,
              assigned_to: { $in: nonAdminUserIds },
              status: { $nin: ["converted", "rejected"] },
              created_at: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: "$stage",
              count: { $sum: 1 },
              amount: { $sum: { $ifNull: ["$deal_value_estimate", 0] } },
            },
          },
        ])
      : await (async () => {
          const [openStageAgg, lostAgg, wonAgg] = await Promise.all([
            Deal.aggregate([
              {
                $match: {
                  status: "open",
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
                  createdAt: { $gte: start, $lte: end },
                  stage: { $nin: ["P6", "P7"] },
                }
              },
              { $group: { _id: "$stage", count: { $sum: 1 }, amount: { $sum: "$dealValue" } } },
            ]),
            Deal.aggregate([
              {
                $match: {
                  status: "lost",
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
                  actualCloseDate: { $gte: start, $lte: end },
                }
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: "$dealValue" },
                }
              },
            ]),
            Deal.aggregate([
              {
                $match: {
                  status: "won",
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
                  actualCloseDate: { $gte: start, $lte: end },
                }
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  amount: { $sum: "$dealValue" },
                }
              },
            ]),
          ]);

          const lostStage = lostAgg[0]
            ? [{ _id: "P6", count: lostAgg[0].count || 0, amount: lostAgg[0].amount || 0 }]
            : [];
          const wonStage = wonAgg[0]
            ? [{ _id: "P7", count: wonAgg[0].count || 0, amount: wonAgg[0].amount || 0 }]
            : [];

          return [...openStageAgg, ...lostStage, ...wonStage];
        })();

  const map = new Map(agg.map((x) => [x._id, x]));
  return stages.map((s) => ({
    code: s,
    label: s,
    count: map.get(s)?.count || 0,
    amount: map.get(s)?.amount || 0,
  }));
}

/**
 * TEAM PERFORMANCE
 * Shape must match frontend:
 * [{ id, name, value, pct, color }, ...]
 */
async function getTeamPerformance(range) {
  const { start, end } = getRangeDates(range);
  const nonAdminUserIds = await getNonAdminUserIds();

  // Won revenue per salesperson in range
  const userAgg = await Deal.aggregate([
    {
      $match: {
        status: "won",
        is_deleted: { $ne: true },
        actualCloseDate: { $gte: start, $lte: end },
        assignedTo: { $in: nonAdminUserIds },
      },
    },
    { $group: { _id: "$assignedTo", value: { $sum: "$dealValue" } } },
  ]);
  const valueByUserId = new Map(
    userAgg.map((x) => [String(x._id), Number(x.value || 0)])
  );

  const teams = await Team.find({})
    .select("_id name teamLeads.userId members.userId")
    .lean();

  const teamRows = teams.map((team) => {
    const memberIds = [
      ...(team?.members || []).map((m) => String(m.userId || "")),
      ...(team?.teamLeads || []).map((lead) => String(lead.userId || "")),
    ].filter(Boolean);

    const uniqueMemberIds = [...new Set(memberIds)];
    const achievedValue = uniqueMemberIds.reduce(
      (sum, userId) => sum + Number(valueByUserId.get(userId) || 0),
      0
    );

    return {
      id: String(team._id),
      name: String(team.name || "").trim() || "Unnamed Team",
      value: achievedValue,
    };
  });

  const nonZeroTeams = teamRows.filter((t) => t.value > 0);
  const rankedTeams = (nonZeroTeams.length ? nonZeroTeams : teamRows)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const maxValue = Math.max(...rankedTeams.map((x) => x.value), 0);
  return rankedTeams.map((x, idx) => {
    const pct = maxValue ? Math.round((x.value / maxValue) * 100) : 0;
    const color = idx === 0 ? "success" : idx === 1 ? "primary" : "info";
    return {
      id: x.id,
      name: x.name,
      value: x.value,
      pct: Math.max(0, Math.min(100, pct)),
      color,
    };
  });
}

/**
 * FOLLOWUPS
 * Shape must match frontend:
 * [{ id, title, owner, score, date, priority, icon }, ...]
 */
async function getFollowups(range, viewerUserId = null) {
  const { start, end } = getRangeDates(range);
  const now = new Date();

  const baseMatch = {
    is_deleted: { $ne: true },
    kind: { $in: ["followup", "meeting"] },
    dueDateTime: { $gte: start, $lte: end },
  };

  const list = await Followup.find(
    {
      ...baseMatch,
      status: { $in: ["pending", "overdue"] },
    },
    {
      title: 1,
      clientName: 1,
      kind: 1,
      actionType: 1,
      assignedTo: 1,
      aiScore: 1,
      priority: 1,
      status: 1,
      dueDateTime: 1,
    }
  )
    .sort({ dueDateTime: 1, aiScore: -1 })
    .limit(20)
    .lean();

  const userIds = [...new Set(list.map((f) => String(f.assignedTo)).filter(Boolean))];
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
  const nameMap = new Map(users.map((u) => [String(u._id), u.name]));

  const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };
  const comparePriority = (a, b) => {
    const pa = priorityRank[String(a.priority || "").toLowerCase()] || 0;
    const pb = priorityRank[String(b.priority || "").toLowerCase()] || 0;
    if (pb !== pa) return pb - pa;
    return Number(b.score || 0) - Number(a.score || 0);
  };

  const mapped = list.map((f) => ({
      id: String(f._id),
      title: f.title,
      companyName: f.clientName || "",
      itemType: f.kind === "meeting" ? "Meeting" : "Follow-up",
      actionType: f.actionType || "",
      owner: nameMap.get(String(f.assignedTo)) || "Unknown",
      score: Number(f.aiScore || 0),
      date: f.dueDateTime ? new Date(f.dueDateTime).toLocaleDateString("en-IN") : "",
      dueDateTime: f.dueDateTime ? new Date(f.dueDateTime).toISOString() : "",
      status: String(f.status || "").toLowerCase(),
      priority: f.priority || "medium",
      icon: iconFromActionType(f.actionType),
  }));

  const upcoming = mapped
    .filter((item) => item.status === "pending" && new Date(item.dueDateTime || 0) >= now)
    .sort((a, b) => {
      const timeDiff = new Date(a.dueDateTime || 0) - new Date(b.dueDateTime || 0);
      if (timeDiff !== 0) return timeDiff;
      return comparePriority(a, b);
    });

  const previous = mapped
    .filter((item) => new Date(item.dueDateTime || 0) < now)
    .sort((a, b) => {
      const timeDiff = new Date(b.dueDateTime || 0) - new Date(a.dueDateTime || 0);
      if (timeDiff !== 0) return timeDiff;
      return comparePriority(a, b);
    });

  const ordered = upcoming.length > 0 ? upcoming : previous;

  return ordered.map(({ dueDateTime, status, ...row }) => row);
}

/**
 * RECENT DEALS
 * Shape must match frontend:
 * [{ id, client, stage, value, risk, closeDate }, ...]
 */
async function getRecentDeals(range) {
  const { start, end } = getRangeDates(range);
  const nonAdminUserIds = await getNonAdminUserIds();

  const deals = await Deal.find(
    {
      is_deleted: { $ne: true },
      assignedTo: { $in: nonAdminUserIds },
      createdAt: { $gte: start, $lte: end },
    },
    { stage: 1, dealValue: 1, aiRiskScore: 1, expectedCloseDate: 1, actualCloseDate: 1, createdAt: 1, client_id: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(4)
    .populate({ path: "client_id", model: "client", select: "name" })
    .lean();

  return deals.map((d) => ({
    id: String(d._id),
    client: d.client_id?.name || "Client",
    stage: d.stage || "P1",
    value: Number(d.dealValue || 0),
    risk: riskLabelFromAi(d.aiRiskScore),
    closeDate: d.expectedCloseDate
      ? new Date(d.expectedCloseDate).toLocaleDateString("en-IN")
      : d.actualCloseDate
      ? new Date(d.actualCloseDate).toLocaleDateString("en-IN")
      : "",
  }));
}

module.exports = {
  getSummary,
  getPipeline,
  getTeamPerformance,
  getFollowups,
  getRecentDeals,
};
