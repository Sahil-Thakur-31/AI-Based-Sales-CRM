//Purpose: All MongoDB aggregation + formatting to match frontend response shapes.
//Uses your models:


// backend/services/adminDashboardservice.js
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Followup = require("../models/followUp");
const LeadContacts = require("../models/leadContacts");
const ClientContact = require("../models/client_contact");
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
const DEAL_WON_STAGE = "P7";
const DEAL_LOST_STAGE = "P6";
const dealClosedNorMatch = {
  $nor: [
    { stage: DEAL_WON_STAGE },
    { stage: DEAL_LOST_STAGE }
  ]
};

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

function iconFromActionType(actionType = "") {
  const a = String(actionType).toLowerCase();
  if (a.includes("call")) return "📞";
  if (a.includes("email")) return "✉️";
  if (a.includes("meeting") || a.includes("demo")) return "🤝";
  if (a.includes("doc") || a.includes("contract")) return "📄";
  return "🔔";
}

function pickPrimaryPhone(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  if (typeof value === "string") return value.split(",")[0].trim();
  return "";
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
async function getSummary(filters = {}) {
  const { start, end, prevStart, prevEnd } = getRangeDates(filters.range, filters);
  const nonAdminUserIds = await getNonAdminUserIds();

  // Won revenue in current range
  const wonAgg = await Deal.aggregate([
    { $match: { stage: DEAL_WON_STAGE, is_deleted: { $ne: true }, assignedTo: { $in: nonAdminUserIds }, actualCloseDate: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenueWon = wonAgg[0]?.total || 0;

  // Won revenue in previous range
  const prevWonAgg = await Deal.aggregate([
    { $match: { stage: DEAL_WON_STAGE, is_deleted: { $ne: true }, assignedTo: { $in: nonAdminUserIds }, actualCloseDate: { $gte: prevStart, $lte: prevEnd } } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const revenuePrev = prevWonAgg[0]?.total || 0;

  // Active deals are current pipeline counts, not created-in-range counts.
  const activeDeals = await Deal.countDocuments({
    ...dealClosedNorMatch,
    is_deleted: { $ne: true },
    assignedTo: { $in: nonAdminUserIds },
  });

  // Delta still tells how many active deals were created in the selected range.
  const activeDealsCreatedInRange = await Deal.countDocuments({
    ...dealClosedNorMatch,
    is_deleted: { $ne: true },
    assignedTo: { $in: nonAdminUserIds },
    createdAt: { $gte: start, $lte: end },
  });
  const activeDealsPrev = await Deal.countDocuments({
    ...dealClosedNorMatch,
    is_deleted: { $ne: true },
    assignedTo: { $in: nonAdminUserIds },
    createdAt: { $gte: prevStart, $lte: prevEnd },
  });

  // Win rate (won / (won+lost)) in this range based on actualCloseDate
  const closedAgg = await Deal.aggregate([
    {
      $match: {
        is_deleted: { $ne: true },
        assignedTo: { $in: nonAdminUserIds },
        actualCloseDate: { $gte: start, $lte: end },
        stage: { $in: [DEAL_WON_STAGE, DEAL_LOST_STAGE] },
      },
    },
    { $group: { _id: "$stage", c: { $sum: 1 } } },
  ]);
  const wonCount = closedAgg.find((x) => x._id === DEAL_WON_STAGE)?.c || 0;
  const lostCount = closedAgg.find((x) => x._id === DEAL_LOST_STAGE)?.c || 0;
  const totalClosed = wonCount + lostCount;
  const winRatePct = totalClosed === 0 ? 0 : Math.round((wonCount / totalClosed) * 100);

  const prevClosedAgg = await Deal.aggregate([
    {
      $match: {
        is_deleted: { $ne: true },
        assignedTo: { $in: nonAdminUserIds },
        actualCloseDate: { $gte: prevStart, $lte: prevEnd },
        stage: { $in: [DEAL_WON_STAGE, DEAL_LOST_STAGE] },
      },
    },
    { $group: { _id: "$stage", c: { $sum: 1 } } },
  ]);
  const prevWonCount = prevClosedAgg.find((x) => x._id === DEAL_WON_STAGE)?.c || 0;
  const prevLostCount = prevClosedAgg.find((x) => x._id === DEAL_LOST_STAGE)?.c || 0;
  const prevTotalClosed = prevWonCount + prevLostCount;
  const prevWinRate = prevTotalClosed === 0 ? 0 : Math.round((prevWonCount / prevTotalClosed) * 100);

  // Pipeline value is current live pipeline value.
  const pipeAgg = await Deal.aggregate([
    {
      $match: {
        ...dealClosedNorMatch,
        is_deleted: { $ne: true },
        assignedTo: { $in: nonAdminUserIds },
      }
    },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);
  const pipelineValue = pipeAgg[0]?.total || 0;

  // (Optional) pipeline vs target
  // For now: keep 0 to avoid wrong info until target logic is final.
  const pipelineDeltaPct = 0;

  // Open leads are current lead pipeline counts.
  const openLeads = await Lead.countDocuments({
    is_active: true,
    is_deleted: { $ne: true },
    assigned_to: { $in: nonAdminUserIds },
    converted_to_deal: { $ne: true },
    stage: { $ne: "P7" },
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
    activeDealsDelta: activeDealsCreatedInRange - activeDealsPrev,

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
async function getPipeline(filters = {}, pipelineType = "deal") {
  const normalizedType = String(pipelineType || "deal").toLowerCase() === "lead" ? "lead" : "deal";
  const nonAdminUserIds = await getNonAdminUserIds();
  const stages = normalizedType === "deal"
    ? ["P1", "P2", "P3", "P6", "P7"]
    : ["P1", "P2", "P3", "P4", "P5", "P6"];

  const agg =
    normalizedType === "lead"
      ? await (async () => {
          return Lead.aggregate([
            {
              $match: {
                is_deleted: { $ne: true },
                assigned_to: { $in: nonAdminUserIds },
                converted_to_deal: { $ne: true },
                stage: { $in: ["P1", "P2", "P3", "P4", "P5", "P6"] },
              },
            },
            {
              $group: {
                _id: "$stage",
                count: { $sum: 1 },
                amount: { $sum: { $ifNull: ["$deal_value_estimate", 0] } },
              },
            },
          ]);
        })()
      : await (async () => {
          const [openStageAgg, lostAgg, wonAgg] = await Promise.all([
            Deal.aggregate([
              {
                $match: {
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
                  ...dealClosedNorMatch,
                }
              },
              { $group: { _id: "$stage", count: { $sum: 1 }, amount: { $sum: "$dealValue" } } },
            ]),
            Deal.aggregate([
              {
                $match: {
                  stage: DEAL_LOST_STAGE,
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
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
                  stage: DEAL_WON_STAGE,
                  is_deleted: { $ne: true },
                  assignedTo: { $in: nonAdminUserIds },
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
async function getTeamPerformance(filters = {}) {
  const { start, end } = getRangeDates(filters.range, filters);
  const nonAdminUserIds = await getNonAdminUserIds();

  // Won revenue per salesperson in range
  const userAgg = await Deal.aggregate([
    {
      $match: {
        stage: DEAL_WON_STAGE,
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
async function getFollowups(filters = {}, viewerUserId = null) {
  const { start, end } = getRangeDates(filters.range, filters);
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
      leadId: 1,
      dealId: 1,
      clientId: 1,
      contactId: 1,
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

  const dealIds = [...new Set(list.map((f) => String(f.dealId || "")).filter(Boolean))];
  const linkedDeals = dealIds.length
    ? await Deal.find({ _id: { $in: dealIds } }, { lead_id: 1, client_id: 1 }).lean()
    : [];
  const dealMap = new Map(linkedDeals.map((deal) => [String(deal._id), deal]));

  const leadIds = [...new Set([
    ...list.map((f) => String(f.leadId || "")).filter(Boolean),
    ...linkedDeals.map((deal) => String(deal.lead_id || "")).filter(Boolean),
  ])];
  const clientIds = [...new Set([
    ...list.map((f) => String(f.clientId || "")).filter(Boolean),
    ...linkedDeals.map((deal) => String(deal.client_id || "")).filter(Boolean),
  ])];
  const contactIds = [...new Set(list.map((f) => String(f.contactId || "")).filter(Boolean))];

  const [leadContacts, clientContacts] = await Promise.all([
    leadIds.length
      ? LeadContacts.find({ lead_id: { $in: leadIds } })
          .sort({ is_primary: -1, created_at: 1 })
          .lean()
      : [],
    clientIds.length || contactIds.length
      ? ClientContact.find({
          $or: [
            ...(clientIds.length ? [{ client_id: { $in: clientIds }, is_active: true }] : []),
            ...(contactIds.length ? [{ _id: { $in: contactIds } }] : []),
          ],
        })
          .sort({ is_primary: -1, createdAt: 1 })
          .lean()
      : [],
  ]);

  const leadPhoneMap = new Map();
  const clientPhoneMap = new Map();
  const contactPhoneMap = new Map();

  for (const contact of leadContacts) {
    const leadId = String(contact.lead_id || "");
    if (!leadId || leadPhoneMap.has(leadId)) continue;
    leadPhoneMap.set(leadId, pickPrimaryPhone(contact.phone));
  }

  for (const contact of clientContacts) {
    const contactId = String(contact._id || "");
    if (contactId && !contactPhoneMap.has(contactId)) {
      contactPhoneMap.set(contactId, pickPrimaryPhone(contact.phone));
    }

    const clientId = String(contact.client_id || "");
    if (!clientId || clientPhoneMap.has(clientId)) continue;
    clientPhoneMap.set(clientId, pickPrimaryPhone(contact.phone));
  }

  const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };
  const comparePriority = (a, b) => {
    const pa = priorityRank[String(a.priority || "").toLowerCase()] || 0;
    const pb = priorityRank[String(b.priority || "").toLowerCase()] || 0;
    if (pb !== pa) return pb - pa;
    return Number(b.score || 0) - Number(a.score || 0);
  };

  const mapped = list.map((f) => {
      const deal = dealMap.get(String(f.dealId || ""));
      const leadId = String(f.leadId || deal?.lead_id || "");
      const clientId = String(f.clientId || deal?.client_id || "");
      const contactId = String(f.contactId || "");
      const itemType = f.kind === "meeting" ? "Meeting" : "Follow-up";
      const contactPhone =
        itemType === "Meeting"
          ? ""
          : contactPhoneMap.get(contactId) ||
            leadPhoneMap.get(leadId) ||
            clientPhoneMap.get(clientId) ||
            "";

      return {
      id: String(f._id),
      title: f.title,
      companyName: f.clientName || "",
      itemType,
      actionType: f.actionType || "",
      owner: nameMap.get(String(f.assignedTo)) || "Unknown",
      score: Number(f.aiScore || 0),
      contactPhone,
      date: f.dueDateTime ? new Date(f.dueDateTime).toLocaleDateString("en-IN") : "",
      dueDateTime: f.dueDateTime ? new Date(f.dueDateTime).toISOString() : "",
      status: String(f.status || "").toLowerCase(),
      priority: f.priority || "medium",
      icon: iconFromActionType(f.actionType),
    };
  });

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
 * [{ id, dealName, stage, value, closeDate }, ...]
 */
async function getRecentDeals(filters = {}) {
  const { start, end } = getRangeDates(filters.range, filters);
  const nonAdminUserIds = await getNonAdminUserIds();

  const deals = await Deal.find(
    {
      is_deleted: { $ne: true },
      assignedTo: { $in: nonAdminUserIds },
      stage: { $in: ["P1", "P2", "P3"] },
      createdAt: { $gte: start, $lte: end },
    },
    { deal_name: 1, stage: 1, dealValue: 1, expectedCloseDate: 1, actualCloseDate: 1, createdAt: 1 }
  )
    .sort({ createdAt: -1 })
    .lean();

  return deals.map((d) => ({
    id: String(d._id),
    dealName: d.deal_name || "Unnamed Deal",
    stage: d.stage || "P1",
    value: Number(d.dealValue || 0),
    expectedCloseDate: d.expectedCloseDate
      ? new Date(d.expectedCloseDate).toLocaleDateString("en-IN")
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
