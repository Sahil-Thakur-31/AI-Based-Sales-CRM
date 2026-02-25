//Purpose: All MongoDB aggregation + formatting to match frontend response shapes.
//Uses your models:


// backend/services/adminDashboard.admin.service.js
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Followup = require("../models/followUp");
const User = require("../models/users");
const SalesTargets = require("../models/sales_targets");

// Optional model - if file exists in your models folder
let AiGeneratedLeads = null;
try {
  AiGeneratedLeads = require("../models/ai_generated_leads");
} catch (e) {
  AiGeneratedLeads = null;
}

const { getRangeDates } = require("./dashboardRange.admin");

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

  // Won revenue in current range
  const wonAgg = await Deal.aggregate([
    { $match: { status: "won", isDeleted: { $ne: true }, actualCloseDate: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenueWon = wonAgg[0]?.total || 0;

  // Won revenue in previous range
  const prevWonAgg = await Deal.aggregate([
    { $match: { status: "won", isDeleted: { $ne: true }, actualCloseDate: { $gte: prevStart, $lte: prevEnd } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenuePrev = prevWonAgg[0]?.total || 0;

  // Active deals (open) created in this range
  const activeDeals = await Deal.countDocuments({
    status: "open",
    isDeleted: { $ne: true },
    createdAt: { $gte: start, $lte: end },
  });

  const activeDealsPrev = await Deal.countDocuments({
    status: "open",
    isDeleted: { $ne: true },
    createdAt: { $gte: prevStart, $lte: prevEnd },
  });

  // Win rate (won / (won+lost)) in this range based on actualCloseDate
  const closedAgg = await Deal.aggregate([
    {
      $match: {
        isDeleted: { $ne: true },
        status: { $in: ["won", "lost"] },
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
        isDeleted: { $ne: true },
        status: { $in: ["won", "lost"] },
        actualCloseDate: { $gte: prevStart, $lte: prevEnd },
      },
    },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);
  const prevWonCount = prevClosedAgg.find((x) => x._id === "won")?.c || 0;
  const prevLostCount = prevClosedAgg.find((x) => x._id === "lost")?.c || 0;
  const prevTotalClosed = prevWonCount + prevLostCount;
  const prevWinRate = prevTotalClosed === 0 ? 0 : Math.round((prevWonCount / prevTotalClosed) * 100);

  // Pipeline value (sum open deal values)
  const pipeAgg = await Deal.aggregate([
    { $match: { status: "open", isDeleted: { $ne: true } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const pipelineValue = pipeAgg[0]?.total || 0;

  // (Optional) pipeline vs target
  // For now: keep 0 to avoid wrong info until target logic is final.
  const pipelineDeltaPct = 0;

  // Open leads created in this range
  const openLeads = await Lead.countDocuments({
    is_active: true,
    is_deleted: { $ne: "Yes" },
    status: { $in: ["new", "contacted", "qualified"] },
    created_at: { $gte: start, $lte: end },
  });

  // AI-sourced leads created in this range (if model exists)
  let openLeadsFromAI = 0;
  if (AiGeneratedLeads) {
    openLeadsFromAI = await AiGeneratedLeads.countDocuments({
      is_active: true,
      created_at: { $gte: start, $lte: end },
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
async function getPipeline(/* range */) {
  const stages = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];

  const agg = await Deal.aggregate([
    { $match: { status: "open", isDeleted: { $ne: true } } },
    { $group: { _id: "$stage", count: { $sum: 1 }, amount: { $sum: "$dealValue" } } },
  ]);

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

  // Won revenue per salesperson in range
  const agg = await Deal.aggregate([
    {
      $match: {
        status: "won",
        isDeleted: { $ne: true },
        actualCloseDate: { $gte: start, $lte: end },
        assignedTo: { $ne: null },
      },
    },
    { $group: { _id: "$assignedTo", value: { $sum: "$dealValue" } } },
    { $sort: { value: -1 } },
    { $limit: 6 },
  ]);

  const userIds = agg.map((x) => x._id);
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
  const nameMap = new Map(users.map((u) => [String(u._id), u.name]));

  // Optional: compute percent vs target if available
  const periodType = range === "quarter" ? "quarterly" : "monthly";
  const targets = await SalesTargets.find(
    { period_type: periodType, user_id: { $in: userIds } },
    { user_id: 1, revenue_target: 1 }
  ).lean();

  const targetMap = new Map(targets.map((t) => [String(t.user_id), Number(t.revenue_target || 0)]));

  const maxValue = Math.max(...agg.map((x) => x.value), 0);

  return agg.map((x, idx) => {
    const id = String(x._id);
    const target = targetMap.get(id) || 0;

    const pct =
      target > 0
        ? Math.round((x.value / target) * 100)
        : maxValue
        ? Math.round((x.value / maxValue) * 100)
        : 0;

    const color = idx === 0 ? "success" : idx === 1 ? "primary" : "info";

    return {
      id,
      name: nameMap.get(id) || "Unknown",
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
async function getFollowups(range) {
  const { end } = getRangeDates(range);
  const now = new Date();

  const list = await Followup.find(
    {
      isDeleted: false,
      status: { $in: ["pending", "overdue"] },
      dueDateTime: { $gte: now, $lte: end },
    },
    { title: 1, assignedTo: 1, aiScore: 1, priority: 1, dueDateTime: 1, actionType: 1 }
  )
    .sort({ dueDateTime: 1, aiScore: -1 })
    .limit(20)
    .lean();

  const userIds = [...new Set(list.map((f) => String(f.assignedTo)).filter(Boolean))];
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
  const nameMap = new Map(users.map((u) => [String(u._id), u.name]));

  return list.map((f) => ({
    id: String(f._id),
    title: f.title,
    owner: nameMap.get(String(f.assignedTo)) || "Unknown",
    score: Number(f.aiScore || 0),
    date: f.dueDateTime ? new Date(f.dueDateTime).toLocaleDateString("en-IN") : "",
    priority: f.priority || "medium",
    icon: iconFromActionType(f.actionType),
  }));
}

/**
 * RECENT DEALS
 * Shape must match frontend:
 * [{ id, client, stage, value, risk, closeDate }, ...]
 */
async function getRecentDeals(range) {
  const { start, end } = getRangeDates(range);

  const deals = await Deal.find(
    {
      isDeleted: { $ne: true },
      createdAt: { $gte: start, $lte: end },
    },
    { stage: 1, dealValue: 1, aiRiskScore: 1, expectedCloseDate: 1, actualCloseDate: 1, createdAt: 1, client_id: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(15)
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