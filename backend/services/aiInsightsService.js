const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const Lead = require("../models/leads");
const Deal = require("../models/deals");
const Followup = require("../models/followUp");
const Expense = require("../models/expenses");
const Quotation = require("../models/quatations");
const Client = require("../models/client");
const User = require("../models/users");
const Role = require("../models/roles");

const GEMINI_MODEL = "gemini-1.5-flash";
const WON_VALUES = ["Won", "Closed Won", "won", "Closed", "closed"];
const LOST_VALUES = ["Lost", "Closed Lost", "lost"];
const CLOSED_VALUES = ["Won", "Lost", "Closed Won", "Closed Lost", "Closed", "won", "lost", "closed"];
const PENDING_FOLLOWUP_VALUES = ["Pending", "pending", "Scheduled", "scheduled"];
const CONVERTED_LEAD_VALUES = ["Converted", "converted", "Won", "won", "Closed", "closed"];
const ACCEPTED_QUOTATION_VALUES = ["Accepted", "accepted", "Approved", "approved"];

function normalizeFilter(value = "month") {
  const filter = String(value || "").trim().toLowerCase();
  if (filter === "week" || filter === "quarter") return filter;
  return "month";
}

function getFilterLabel(filter = "month") {
  if (filter === "week") return "This Week";
  if (filter === "quarter") return "This Quarter";
  return "This Month";
}

function getFilterShortLabel(filter = "month") {
  if (filter === "week") return "this week";
  if (filter === "quarter") return "this quarter";
  return "this month";
}

function getDateRange(filter) {
  const normalized = normalizeFilter(filter);
  const now = new Date();
  let startDate;

  if (normalized === "week") {
    const reference = new Date(now);
    const day = reference.getDay();
    const diff = reference.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(reference.setDate(diff));
    startDate.setHours(0, 0, 0, 0);
  } else if (normalized === "quarter") {
    const quarter = Math.floor(now.getMonth() / 3);
    startDate = new Date(now.getFullYear(), quarter * 3, 1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate.setHours(0, 0, 0, 0);
  }

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  return {
    filter: normalized,
    label: getFilterLabel(normalized),
    shortLabel: getFilterShortLabel(normalized),
    startDate,
    endDate,
  };
}

function toObjectId(value) {
  const raw = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

function toIdString(value) {
  return String(value || "").trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => toIdString(value)).filter(Boolean))];
}

function safeNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return safeNumber(value).toLocaleString("en-IN");
}

function formatCurrency(value) {
  return safeNumber(value).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function startOfToday() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return todayStart;
}

function endOfToday() {
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return todayEnd;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function normalizeRoleName(value = "") {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin" || role === "manager") return role;
  if (["user", "sales person", "salesperson", "sales"].includes(role)) return "user";
  return "user";
}

async function safeQuery(label, fallback, task) {
  try {
    return await task();
  } catch (error) {
    console.error(`[AI Insights Query Failed] ${label}:`, error?.message || error);
    return fallback;
  }
}

async function resolveRoleName(roleValue) {
  const direct = normalizeRoleName(roleValue?.name || roleValue);
  if (direct !== "user" || String(roleValue?.name || roleValue || "").trim().toLowerCase() === "user") {
    return direct;
  }

  const roleId = toObjectId(roleValue);
  if (!roleId) return "user";

  const roleDoc = await safeQuery("resolveRoleName", null, () =>
    Role.findById(roleId).select("name").lean()
  );

  return normalizeRoleName(roleDoc?.name);
}

function buildUserFilter(fieldName, ids = []) {
  const objectIds = ids.map((id) => toObjectId(id)).filter(Boolean);
  if (!objectIds.length) return {};
  return { [fieldName]: { $in: objectIds } };
}

function buildClientFilter(ids = []) {
  return buildUserFilter("createdBy", ids);
}

function buildExpenseFilter(ids = []) {
  return buildUserFilter("userId", ids);
}

function buildQuotationFilter(ids = []) {
  const objectIds = ids.map((id) => toObjectId(id)).filter(Boolean);
  if (!objectIds.length) return {};
  return {
    $or: [
      { createdBy: { $in: objectIds } },
      { assignedTo: { $in: objectIds } },
    ],
  };
}

function buildOpenDealMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    stage: { $nin: CLOSED_VALUES },
    status: { $nin: ["won", "Won", "lost", "Lost"] },
  };
}

function buildWonDealMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    $or: [
      { status: { $in: ["won", "Won", "Closed"] } },
      { stage: { $in: WON_VALUES } },
    ],
  };
}

function buildLostDealMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    $or: [
      { status: { $in: ["lost", "Lost"] } },
      { stage: { $in: LOST_VALUES } },
    ],
  };
}

function buildConvertedLeadMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    $or: [
      { converted_to_deal: true },
      { status: { $in: CONVERTED_LEAD_VALUES } },
    ],
  };
}

function buildPendingFollowupMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    status: { $in: PENDING_FOLLOWUP_VALUES },
  };
}

function buildOverdueFollowupMatch(baseMatch = {}) {
  return {
    ...baseMatch,
    status: { $in: ["Pending", "pending"] },
    $or: [
      { scheduledDate: { $lt: new Date() } },
      { dueDateTime: { $lt: new Date() } },
    ],
  };
}

function buildTodayFollowupMatch(baseMatch = {}) {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  return {
    ...baseMatch,
    $or: [
      { scheduledDate: { $gte: todayStart, $lte: todayEnd } },
      { dueDateTime: { $gte: todayStart, $lte: todayEnd } },
    ],
  };
}

function withDateRange(baseMatch = {}, fieldName, dateRange) {
  if (!fieldName || !dateRange?.startDate || !dateRange?.endDate) return { ...baseMatch };
  return {
    ...baseMatch,
    [fieldName]: {
      $gte: dateRange.startDate,
      $lte: dateRange.endDate,
    },
  };
}

function summarizeForLog(evidence) {
  return {
    mode: evidence.scope,
    leadTotal: safeNumber(evidence.metrics?.totalLeads || evidence.metrics?.myLeads || evidence.metrics?.teamLeads),
    openDeals: safeNumber(evidence.metrics?.openDeals),
    wonDeals: safeNumber(evidence.metrics?.wonDeals),
    lostDeals: safeNumber(evidence.metrics?.lostDeals),
    overdueFollowUps: safeNumber(evidence.metrics?.overdueFollowups),
    pendingFollowUps: safeNumber(evidence.metrics?.pendingFollowups),
    todayFollowUps: safeNumber(evidence.metrics?.todayFollowups),
  };
}

function normalizeTrend(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "up" || raw === "down" || raw === "neutral") return raw;
  return "neutral";
}

function normalizeUrgency(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function normalizeImpact(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high") return "High";
  if (raw === "low") return "Low";
  return "Medium";
}

function normalizeSeverity(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "critical" || raw === "warning" || raw === "info") return raw;
  return "info";
}

function buildKeyMetrics(scopeRole, metrics) {
  if (scopeRole === "company") {
    return [
      { label: "Total Leads", value: formatNumber(metrics.totalLeads), trend: "neutral", note: `${formatNumber(metrics.newLeads7d)} created in 7 days` },
      { label: "Open Deals", value: formatNumber(metrics.openDeals), trend: metrics.openDeals > 0 ? "up" : "neutral", note: `${formatCurrency(metrics.totalPipelineValue)} pipeline value` },
      { label: "Won Value", value: formatCurrency(metrics.totalWonValue), trend: metrics.wonDeals >= metrics.lostDeals ? "up" : "neutral", note: `${formatNumber(metrics.wonDeals)} won deals` },
      { label: "Overdue Follow-ups", value: formatNumber(metrics.overdueFollowups), trend: metrics.overdueFollowups > 0 ? "down" : "neutral", note: `${formatNumber(metrics.pendingFollowups)} pending total` },
      { label: "Pending Approvals", value: formatNumber(metrics.pendingExpenses), trend: metrics.pendingExpenses > 0 ? "down" : "neutral", note: `${formatNumber(metrics.totalExpenses)} expense records` },
      { label: "Accepted Quotes", value: formatNumber(metrics.acceptedQuotations), trend: metrics.acceptedQuotations > 0 ? "up" : "neutral", note: `${formatNumber(metrics.totalQuotations)} quotations total` },
    ];
  }

  if (scopeRole === "team") {
    return [
      { label: "Team Leads", value: formatNumber(metrics.teamLeads), trend: metrics.newLeads7d > 0 ? "up" : "neutral", note: `${formatNumber(metrics.newLeads7d)} new this week` },
      { label: "Open Deals", value: formatNumber(metrics.openDeals), trend: metrics.openDeals > 0 ? "up" : "neutral", note: `${formatCurrency(metrics.totalPipelineValue)} pipeline value` },
      { label: "Won Value", value: formatCurrency(metrics.totalWonValue), trend: metrics.wonDeals >= metrics.lostDeals ? "up" : "neutral", note: `${formatNumber(metrics.wonDeals)} won deals` },
      { label: "Pending Follow-ups", value: formatNumber(metrics.pendingFollowups), trend: metrics.pendingFollowups > 0 ? "neutral" : "up", note: `${formatNumber(metrics.overdueFollowups)} overdue` },
      { label: "Pending Expenses", value: formatNumber(metrics.pendingExpenses), trend: metrics.pendingExpenses > 0 ? "down" : "neutral", note: `${formatNumber(metrics.totalExpenses)} expenses submitted` },
    ];
  }

  return [
    { label: "My Leads", value: formatNumber(metrics.totalLeads), trend: metrics.newLeads7d > 0 ? "up" : "neutral", note: `${formatNumber(metrics.newLeads7d)} new this week` },
    { label: "Open Deals", value: formatNumber(metrics.openDeals), trend: metrics.openDeals > 0 ? "up" : "neutral", note: `${formatCurrency(metrics.totalPipelineValue)} open pipeline` },
    { label: "Won Value", value: formatCurrency(metrics.totalWonValue), trend: metrics.wonDeals >= metrics.lostDeals ? "up" : "neutral", note: `${formatNumber(metrics.wonDeals)} won deals` },
    { label: "Today Follow-ups", value: formatNumber(metrics.todayFollowups), trend: metrics.todayFollowups > 0 ? "neutral" : "up", note: `${formatNumber(metrics.pendingFollowups)} pending total` },
    { label: "Overdue Follow-ups", value: formatNumber(metrics.overdueFollowups), trend: metrics.overdueFollowups > 0 ? "down" : "neutral", note: "Needs attention first" },
    { label: "My Quotations", value: formatNumber(metrics.totalQuotations), trend: metrics.totalQuotations > 0 ? "up" : "neutral", note: `${formatNumber(metrics.totalQuotations)} created` },
  ];
}

function buildOfflineInsights(evidence) {
  const metrics = evidence.metrics || {};
  const todayPriorities = [];
  const warnings = [];

  if (metrics.overdueFollowups > 0) {
    todayPriorities.push({
      icon: "🚨",
      title: "Clear overdue follow-ups",
      detail: `${formatNumber(metrics.overdueFollowups)} follow-ups are overdue and need immediate attention.`,
      urgency: "high",
    });
    warnings.push({
      title: "Overdue follow-ups are active",
      detail: `${formatNumber(metrics.overdueFollowups)} follow-ups are past due in the CRM.`,
      severity: "critical",
    });
  }

  if (metrics.todayFollowups > 0) {
    todayPriorities.push({
      icon: "📅",
      title: "Work today's schedule",
      detail: `${formatNumber(metrics.todayFollowups)} follow-ups are scheduled for today.`,
      urgency: "high",
    });
  }

  if (metrics.openDeals > 0) {
    todayPriorities.push({
      icon: "🤝",
      title: "Advance open deals",
      detail: `${formatNumber(metrics.openDeals)} open deals carry ${formatCurrency(metrics.totalPipelineValue)} in pipeline.`,
      urgency: "medium",
    });
  }

  if (metrics.pendingExpenses > 0) {
    warnings.push({
      title: "Expense approvals pending",
      detail: `${formatNumber(metrics.pendingExpenses)} expense records are still pending.`,
      severity: "warning",
    });
  }

  if (metrics.lostDeals > metrics.wonDeals) {
    warnings.push({
      title: "Losses are outpacing wins",
      detail: `${formatNumber(metrics.lostDeals)} lost deals versus ${formatNumber(metrics.wonDeals)} won deals.`,
      severity: "warning",
    });
  }

  const opportunities = [
    {
      title: "Follow up on stale leads",
      detail: `${formatNumber(metrics.pendingFollowups)} pending follow-ups show where faster outreach can unlock movement.`,
      impact: "Medium",
    },
    {
      title: "Advance open deals",
      detail: `${formatNumber(metrics.openDeals)} open deals represent ${formatCurrency(metrics.totalPipelineValue)} of active opportunity.`,
      impact: "High",
    },
  ];

  const summary = evidence.scope === "company"
    ? `The company has ${formatNumber(metrics.newLeads7d)} new leads in the last 7 days, ${formatNumber(metrics.wonDeals)} won deals, and ${formatCurrency(metrics.totalWonValue)} in won value. The live pipeline still shows ${formatNumber(metrics.openDeals)} open deals, while ${formatNumber(metrics.overdueFollowups)} follow-ups are overdue and ${formatNumber(metrics.pendingExpenses)} expenses are still pending.`
    : evidence.scope === "team"
      ? `${evidence.teamName || "This team"} has ${formatNumber(metrics.newLeads7d)} new leads in the last 7 days, ${formatNumber(metrics.wonDeals)} won deals, and ${formatCurrency(metrics.totalWonValue)} in won value. The team still has ${formatNumber(metrics.openDeals)} open deals active and ${formatNumber(metrics.overdueFollowups)} overdue follow-ups to clear.`
      : `You have ${formatNumber(metrics.newLeads7d)} new leads in the last 7 days, ${formatNumber(metrics.wonDeals)} won deals, and ${formatCurrency(metrics.totalWonValue)} in won value. Your live pipeline still has ${formatNumber(metrics.openDeals)} open deals, while ${formatNumber(metrics.overdueFollowups)} follow-ups are overdue and ${formatNumber(metrics.todayFollowups)} are due today.`;

  return {
    summary,
    todayPriorities: todayPriorities.slice(0, 4),
    keyMetrics: buildKeyMetrics(evidence.scope, metrics).slice(0, 6),
    opportunities: opportunities.slice(0, 3),
    warnings,
    coachTip: "Focus first on overdue commitments, then move the highest-value active opportunities one step forward today.",
    weekOutlook: metrics.overdueFollowups > 0
      ? "This week should start with backlog cleanup before pushing for extra volume."
      : metrics.openDeals > 0
        ? "This week should focus on moving active deals closer to conversion."
        : "This week should focus on building fresh, high-quality pipeline.",
  };
}

function ensureInsightsShape(payload, fallback) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    summary: String(source.summary || fallback.summary || "").trim(),
    todayPriorities: Array.isArray(source.todayPriorities)
      ? source.todayPriorities.slice(0, 4).map((item) => ({
        icon: String(item?.icon || "🎯").trim() || "🎯",
        title: String(item?.title || "").trim(),
        detail: String(item?.detail || "").trim(),
        urgency: normalizeUrgency(item?.urgency),
      })).filter((item) => item.title && item.detail)
      : fallback.todayPriorities,
    keyMetrics: Array.isArray(source.keyMetrics)
      ? source.keyMetrics.slice(0, 6).map((item) => ({
        label: String(item?.label || "").trim(),
        value: item?.value ?? "",
        trend: normalizeTrend(item?.trend),
        note: String(item?.note || "").trim(),
      })).filter((item) => item.label !== "")
      : fallback.keyMetrics,
    opportunities: Array.isArray(source.opportunities)
      ? source.opportunities.slice(0, 3).map((item) => ({
        title: String(item?.title || "").trim(),
        detail: String(item?.detail || "").trim(),
        impact: normalizeImpact(item?.impact),
      })).filter((item) => item.title && item.detail)
      : fallback.opportunities,
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map((item) => ({
        title: String(item?.title || "").trim(),
        detail: String(item?.detail || "").trim(),
        severity: normalizeSeverity(item?.severity),
      })).filter((item) => item.title && item.detail)
      : fallback.warnings,
    coachTip: String(source.coachTip || fallback.coachTip || "").trim(),
    weekOutlook: String(source.weekOutlook || fallback.weekOutlook || "").trim(),
  };
}

function buildGeminiPrompt(roleLabel, scopeLabel, evidence) {
  return [
    `You are an AI assistant for a Sales CRM system. A ${roleLabel} is viewing their ${scopeLabel} insights dashboard.`,
    "Based on the following REAL CRM data, return ONLY a valid JSON object with NO markdown formatting, NO backticks, NO explanation text.",
    "",
    "The JSON must have exactly these fields:",
    "{",
    "  summary: string (2-3 sentences describing current situation based on the numbers, be specific with actual numbers),",
    "  todayPriorities: array of max 4 objects { icon: emoji string, title: string, detail: string with specific numbers, urgency: high or medium or low },",
    "  keyMetrics: array of 4-6 objects { label: string, value: string or number, trend: up or down or neutral, note: string },",
    "  opportunities: array of 2-3 objects { title: string, detail: string with specific action, impact: High or Medium or Low },",
    "  warnings: array of objects only if real problems exist in the data { title: string, detail: string with specific numbers, severity: critical or warning or info },",
    "  coachTip: string (one specific actionable tip based on the actual numbers),",
    "  weekOutlook: string (one sentence)",
    "}",
    "",
    "Rules:",
    "- Use the actual numbers from the data in your text, not vague statements",
    "- todayPriorities must be based on overdue items and today scheduled items",
    "- warnings array must be empty [] if there are no real problems",
    "- keyMetrics must show the most important numbers for this role",
    "- Do not make up data not present in the evidence",
    "",
    `DATA: ${JSON.stringify(evidence)}`,
  ].join("\n");
}

function loadTeamModel() {
  try {
    return require("../models/Team");
  } catch (e1) {
    try {
      return require("../models/team");
    } catch (e2) {
      try {
        return require("../models/Teams");
      } catch (e3) {
        try {
          return require("../models/teams");
        } catch (e4) {
          throw new Error("Team model not found");
        }
      }
    }
  }
}

function parseGeminiJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty Gemini response");
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

async function requestGeminiInsights(roleLabel, scopeLabel, evidence) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(buildGeminiPrompt(roleLabel, scopeLabel, evidence));
  return parseGeminiJson(result?.response?.text?.() || "");
}

async function buildGlanceMetrics(scope, userId, memberIds, dateRange) {
  const userObjectId = toObjectId(userId);
  const memberObjectIds = uniqueStrings(memberIds).map((id) => toObjectId(id)).filter(Boolean);

  const isCompany = scope === "company";
  const leadScope = isCompany ? {} : scope === "team" ? { assigned_to: { $in: memberObjectIds } } : userObjectId ? { assigned_to: userObjectId } : { assigned_to: null };
  const dealScope = isCompany ? {} : scope === "team" ? { assignedTo: { $in: memberObjectIds } } : userObjectId ? { assignedTo: userObjectId } : { assignedTo: null };
  const clientScope = isCompany ? {} : scope === "team" ? { createdBy: { $in: memberObjectIds } } : userObjectId ? { createdBy: userObjectId } : { createdBy: null };
  const followupScope = isCompany ? {} : scope === "team" ? { assignedTo: { $in: memberObjectIds } } : userObjectId ? { assignedTo: userObjectId } : { assignedTo: null };
  const expenseScope = isCompany ? {} : scope === "team" ? { userId: { $in: memberObjectIds } } : userObjectId ? { userId: userObjectId } : { userId: null };
  const quotationScope = isCompany ? {} : scope === "team" ? { createdBy: { $in: memberObjectIds } } : userObjectId ? { createdBy: userObjectId } : { createdBy: null };

  const leadBase = { is_deleted: { $ne: true }, ...leadScope };
  const dealBase = { is_deleted: { $ne: true }, ...dealScope };
  const clientBase = { is_deleted: { $ne: true }, ...clientScope };
  const followupBase = { is_deleted: { $ne: true }, ...followupScope };
  const expenseBase = { is_deleted: { $ne: true }, ...expenseScope };
  const quotationBase = { is_deleted: { $ne: true }, isActive: { $ne: false }, ...quotationScope };

  const [newLeads, convertedLeads, wonDeals, lostDeals, newClients, acceptedQuotations, expensesSubmitted, totalLeads, openDeals, pipelineValueRows, totalClients, pendingFollowUps, overdueFollowUps, pendingExpenses, totalUsers, todayFollowUps] = await Promise.all([
    safeQuery("glance newLeads", 0, () => Lead.countDocuments(withDateRange(leadBase, "created_at", dateRange))),
    safeQuery("glance convertedLeads", 0, () => Lead.countDocuments(buildConvertedLeadMatch(withDateRange(leadBase, "created_at", dateRange)))),
    safeQuery("glance wonDeals", 0, () => Deal.countDocuments(buildWonDealMatch(withDateRange(dealBase, "updatedAt", dateRange)))),
    safeQuery("glance lostDeals", 0, () => Deal.countDocuments(buildLostDealMatch(withDateRange(dealBase, "updatedAt", dateRange)))),
    safeQuery("glance newClients", 0, () => Client.countDocuments(withDateRange(clientBase, "createdAt", dateRange))),
    safeQuery("glance acceptedQuotations", 0, () => Quotation.countDocuments({ ...withDateRange(quotationBase, "createdAt", dateRange), status: { $in: ACCEPTED_QUOTATION_VALUES } })),
    safeQuery("glance expensesSubmitted", 0, () => Expense.countDocuments(withDateRange(expenseBase, "createdAt", dateRange))),
    safeQuery("glance totalLeads", 0, () => Lead.countDocuments(leadBase)),
    safeQuery("glance openDeals", 0, () => Deal.countDocuments(buildOpenDealMatch(dealBase))),
    safeQuery("glance pipelineValue", [], () =>
      Deal.aggregate([
        { $match: buildOpenDealMatch(dealBase) },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$dealValue", 0] } } } },
      ])
    ),
    safeQuery("glance totalClients", 0, () => Client.countDocuments(clientBase)),
    safeQuery("glance pendingFollowUps", 0, () => Followup.countDocuments(buildPendingFollowupMatch(followupBase))),
    safeQuery("glance overdueFollowUps", 0, () => Followup.countDocuments(buildOverdueFollowupMatch(followupBase))),
    safeQuery("glance pendingExpenses", 0, () => Expense.countDocuments({ ...expenseBase, $or: [{ "approval.status": "pending" }, { status: "Pending" }, { status: "pending" }] })),
    isCompany ? safeQuery("glance totalUsers", 0, () => User.countDocuments({ is_deleted: { $ne: true } })) : Promise.resolve(0),
    safeQuery("glance todayFollowUps", 0, () => Followup.countDocuments(buildTodayFollowupMatch(buildPendingFollowupMatch(followupBase)))),
  ]);

  const glanceData = {
    newLeads,
    convertedLeads,
    wonDeals,
    lostDeals,
    newClients,
    acceptedQuotations,
    expensesSubmitted,
    totalLeads,
    openDeals,
    pipelineValue: safeNumber(pipelineValueRows?.[0]?.total),
    totalClients,
    pendingFollowUps,
    overdueFollowUps,
    pendingExpenses,
    totalUsers,
    todayFollowUps,
  };

  console.log("[Glance Metrics]", dateRange.filter, JSON.stringify(glanceData, null, 2));
  return glanceData;
}

async function buildCompanyEvidence() {

  const leadBase = { is_deleted: { $ne: true } };
  const dealBase = { is_deleted: { $ne: true } };
  const clientBase = { is_deleted: { $ne: true } };
  const followupBase = { is_deleted: { $ne: true } };
  const expenseBase = { is_deleted: { $ne: true } };
  const quotationBase = { is_deleted: { $ne: true }, isActive: { $ne: false } };
  const userBase = { is_deleted: { $ne: true } };

  const [
    totalLeads,
    newLeads7d,
    convertedLeads,
    totalDeals,
    openDeals,
    wonDeals,
    lostDeals,
    dealValueRows,
    stageBreakdown,
    totalClients,
    clients30d,
    pendingFollowups,
    overdueFollowups,
    todayFollowups,
    totalExpenses,
    pendingExpenses,
    totalQuotations,
    acceptedQuotations,
    totalUsers,
    topPerformers,
  ] = await Promise.all([
    safeQuery("company totalLeads", 0, () => Lead.countDocuments(leadBase)),
    safeQuery("company newLeads7d", 0, () => Lead.countDocuments({ ...leadBase, created_at: { $gte: daysAgo(7) } })),
    safeQuery("company convertedLeads", 0, () => Lead.countDocuments(buildConvertedLeadMatch(leadBase))),
    safeQuery("company totalDeals", 0, () => Deal.countDocuments(dealBase)),
    safeQuery("company openDeals", 0, () => Deal.countDocuments(buildOpenDealMatch(dealBase))),
    safeQuery("company wonDeals", 0, () => Deal.countDocuments(buildWonDealMatch(dealBase))),
    safeQuery("company lostDeals", 0, () => Deal.countDocuments(buildLostDealMatch(dealBase))),
    safeQuery("company dealValueRows", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: null,
            totalPipelineValue: { $sum: { $ifNull: ["$dealValue", 0] } },
            averageDealValue: { $avg: { $ifNull: ["$dealValue", 0] } },
            totalWonValue: { $sum: 0 },
          },
        },
      ])
    ),
    safeQuery("company stageBreakdown", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
    ),
    safeQuery("company totalClients", 0, () => Client.countDocuments(clientBase)),
    safeQuery("company clients30d", 0, () => Client.countDocuments({ ...clientBase, createdAt: { $gte: daysAgo(30) } })),
    safeQuery("company pendingFollowups", 0, () => Followup.countDocuments(buildPendingFollowupMatch(followupBase))),
    safeQuery("company overdueFollowups", 0, () => Followup.countDocuments(buildOverdueFollowupMatch(followupBase))),
    safeQuery("company todayFollowups", 0, () => Followup.countDocuments(buildTodayFollowupMatch(buildPendingFollowupMatch(followupBase)))),
    safeQuery("company totalExpenses", 0, () => Expense.countDocuments(expenseBase)),
    safeQuery("company pendingExpenses", 0, () => Expense.countDocuments({ ...expenseBase, $or: [{ "approval.status": "pending" }, { status: "Pending" }] })),
    safeQuery("company totalQuotations", 0, () => Quotation.countDocuments(quotationBase)),
    safeQuery("company acceptedQuotations", 0, () => Quotation.countDocuments({ ...quotationBase, status: { $in: ACCEPTED_QUOTATION_VALUES } })),
    safeQuery("company totalUsers", 0, () => User.countDocuments(userBase)),
    safeQuery("company topPerformers", [], async () => {
      const rows = await Deal.aggregate([
        { $match: buildWonDealMatch(dealBase) },
        {
          $group: {
            _id: "$assignedTo",
            dealsWon: { $sum: 1 },
            valueWon: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
        { $sort: { valueWon: -1 } },
        { $limit: 5 },
      ]);

      const userIds = rows.map((row) => row?._id).filter(Boolean);
      const users = await safeQuery("company topPerformers users", [], () =>
        User.find({ _id: { $in: userIds } }).select("name").lean()
      );
      const userMap = new Map(users.map((user) => [String(user._id), user?.name || "Unknown"]));

      return rows.map((row) => ({
        userId: String(row?._id || ""),
        name: userMap.get(String(row?._id || "")) || "Unknown",
        dealsWon: safeNumber(row?.dealsWon),
        valueWon: safeNumber(row?.valueWon),
      }));
    }),
  ]);

  const totals = dealValueRows[0] || {};
  const wonValueRows = await safeQuery("company totalWonValue", [], () =>
    Deal.aggregate([
      { $match: buildWonDealMatch(dealBase) },
      {
        $group: {
          _id: null,
          totalWonValue: { $sum: { $ifNull: ["$dealValue", 0] } },
        },
      },
    ])
  );
  const wonTotals = wonValueRows[0] || {};
  const evidence = {
    scope: "company",
    role: "admin",
    teamName: "",
    managerName: "",
    memberCount: 0,
    metrics: {
      totalLeads,
      newLeads7d,
      convertedLeads,
      totalDeals,
      openDeals,
      wonDeals,
      lostDeals,
      totalPipelineValue: safeNumber(totals.totalPipelineValue),
      totalWonValue: safeNumber(wonTotals.totalWonValue),
      averageDealValue: safeNumber(totals.averageDealValue),
      totalClients,
      newClients30d: clients30d,
      pendingFollowups,
      overdueFollowups,
      todayFollowups,
      totalExpenses,
      pendingExpenses,
      totalQuotations,
      acceptedQuotations,
      totalUsers,
    },
    stageBreakdown: stageBreakdown.map((row) => ({
      stage: row?._id || "Unknown",
      count: safeNumber(row?.count),
      value: safeNumber(row?.value),
    })),
    memberPerformance: topPerformers,
    recentLeads: [],
  };

  console.log("[AI Insights Evidence]", JSON.stringify(summarizeForLog(evidence), null, 2));
  return evidence;
}

async function buildPersonalEvidence(user) {
  const userId = toIdString(user?._id);
  const userObjectId = toObjectId(userId);

  const leadBase = { is_deleted: { $ne: true }, assigned_to: userObjectId };
  const dealBase = { is_deleted: { $ne: true }, assignedTo: userObjectId };
  const clientBase = { is_deleted: { $ne: true }, createdBy: userObjectId };
  const followupBase = { is_deleted: { $ne: true }, assignedTo: userObjectId };
  const expenseBase = { is_deleted: { $ne: true }, userId: userObjectId };
  const quotationBase = { is_deleted: { $ne: true }, isActive: { $ne: false }, createdBy: userObjectId };

  const [
    totalLeads,
    newLeads7d,
    convertedLeads,
    openDeals,
    wonDeals,
    lostDeals,
    dealValueRows,
    stageBreakdown,
    totalClients,
    pendingFollowups,
    overdueFollowups,
    todayFollowups,
    totalExpenses,
    pendingExpenses,
    totalQuotations,
    recentLeads,
  ] = await Promise.all([
    safeQuery("personal totalLeads", 0, () => Lead.countDocuments(leadBase)),
    safeQuery("personal newLeads7d", 0, () => Lead.countDocuments({ ...leadBase, created_at: { $gte: daysAgo(7) } })),
    safeQuery("personal convertedLeads", 0, () => Lead.countDocuments(buildConvertedLeadMatch(leadBase))),
    safeQuery("personal openDeals", 0, () => Deal.countDocuments(buildOpenDealMatch(dealBase))),
    safeQuery("personal wonDeals", 0, () => Deal.countDocuments(buildWonDealMatch(dealBase))),
    safeQuery("personal lostDeals", 0, () => Deal.countDocuments(buildLostDealMatch(dealBase))),
    safeQuery("personal dealValueRows", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: null,
            totalPipelineValue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: ["$stage", CLOSED_VALUES] }] },
                      { $not: [{ $in: ["$status", ["won", "Won", "lost", "Lost"]] }] },
                    ],
                  },
                  { $ifNull: ["$dealValue", 0] },
                  0,
                ],
              },
            },
            totalWonValue: { $sum: 0 },
          },
        },
      ])
    ),
    safeQuery("personal stageBreakdown", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
    ),
    safeQuery("personal totalClients", 0, () => Client.countDocuments(clientBase)),
    safeQuery("personal pendingFollowups", 0, () => Followup.countDocuments(buildPendingFollowupMatch(followupBase))),
    safeQuery("personal overdueFollowups", 0, () => Followup.countDocuments(buildOverdueFollowupMatch(followupBase))),
    safeQuery("personal todayFollowups", 0, () => Followup.countDocuments(buildTodayFollowupMatch(buildPendingFollowupMatch(followupBase)))),
    safeQuery("personal totalExpenses", 0, () => Expense.countDocuments(expenseBase)),
    safeQuery("personal pendingExpenses", 0, () => Expense.countDocuments({ ...expenseBase, $or: [{ "approval.status": "pending" }, { status: "Pending" }] })),
    safeQuery("personal totalQuotations", 0, () => Quotation.countDocuments(quotationBase)),
    safeQuery("personal recentLeads", [], () =>
      Lead.find(leadBase)
        .select("company_name status created_at")
        .sort({ created_at: -1 })
        .limit(5)
        .lean()
    ),
  ]);

  const totals = dealValueRows[0] || {};
  const wonValueRows = await safeQuery("personal totalWonValue", [], () =>
    Deal.aggregate([
      { $match: buildWonDealMatch(dealBase) },
      {
        $group: {
          _id: null,
          totalWonValue: { $sum: { $ifNull: ["$dealValue", 0] } },
        },
      },
    ])
  );
  const wonTotals = wonValueRows[0] || {};
  const evidence = {
    scope: "personal",
    role: normalizeRoleName(await resolveRoleName(user?.role)),
    teamName: "",
    managerName: "",
    memberCount: 0,
    metrics: {
      totalLeads,
      newLeads7d,
      convertedLeads,
      openDeals,
      wonDeals,
      lostDeals,
      totalPipelineValue: safeNumber(totals.totalPipelineValue),
      totalWonValue: safeNumber(wonTotals.totalWonValue),
      totalClients,
      pendingFollowups,
      overdueFollowups,
      todayFollowups,
      totalExpenses,
      pendingExpenses,
      totalQuotations,
    },
    stageBreakdown: stageBreakdown.map((row) => ({
      stage: row?._id || "Unknown",
      count: safeNumber(row?.count),
      value: safeNumber(row?.value),
    })),
    memberPerformance: [],
    recentLeads: recentLeads.map((lead) => ({
      name: lead?.company_name || "Untitled Lead",
      status: lead?.status || "unknown",
      createdAt: lead?.created_at || null,
    })),
  };

  console.log("[AI Insights Evidence]", JSON.stringify(summarizeForLog(evidence), null, 2));
  return evidence;
}

async function buildTeamEvidence(teamId) {
  console.log("[AI Insights] buildTeamEvidence called with teamId:", teamId);

  const Team = loadTeamModel();
  const localMongoose = require("mongoose");
  let teamObjectId;

  try {
    teamObjectId = new localMongoose.Types.ObjectId(teamId);
  } catch (error) {
    console.error("[AI Insights] Invalid teamId format:", teamId);
    throw new Error("Invalid teamId: " + teamId);
  }

  const teamDoc = await safeQuery("team evidence teamDoc", null, () =>
    Team.findById(teamObjectId).lean()
  );

  console.log("[AI Insights] Team document found:", JSON.stringify(teamDoc, null, 2));

  if (!teamDoc) {
    console.warn("[AI Insights] No team found for id:", teamId);
    throw new Error("Team not found for id: " + teamId);
  }

  const extractIds = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => (item && typeof item === "object" ? item.userId || item._id || item : item));
  };

  const rawMemberIds = [
    ...extractIds(teamDoc?.members),
    ...extractIds(teamDoc?.teamMembers),
    ...extractIds(teamDoc?.memberIds),
    ...extractIds(teamDoc?.teamLeads),
    teamDoc?.managerId,
    teamDoc?.manager,
    teamDoc?.managerRef,
  ];

  const memberIdsStrings = uniqueStrings(rawMemberIds);
  const memberIds = memberIdsStrings
    .map((id) => {
      try {
        return new mongoose.Types.ObjectId(String(id));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  console.log("[AI Insights] Extracted Team memberIds:", memberIdsStrings);

  const managerIdString = String(
    teamDoc?.managerId ||
    teamDoc?.manager ||
    teamDoc?.managerRef ||
    teamDoc?.teamLeads?.[0]?.userId ||
    ""
  ).trim();

  const managerName = managerIdString
    ? await safeQuery("team evidence managerName", "", async () => {
      const managerDoc = await User.findById(managerIdString)
        .select("name firstName lastName")
        .lean();

      if (!managerDoc) return "";
      const fullName = [managerDoc.firstName, managerDoc.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      return managerDoc?.name || fullName || "Manager";
    })
    : "";

  const leadBase = { is_deleted: { $ne: true }, assigned_to: { $in: memberIds } };
  const dealBase = { is_deleted: { $ne: true }, assignedTo: { $in: memberIds } };
  const clientBase = { is_deleted: { $ne: true }, createdBy: { $in: memberIds } };
  const followupBase = { is_deleted: { $ne: true }, assignedTo: { $in: memberIds } };
  const expenseBase = { is_deleted: { $ne: true }, userId: { $in: memberIds } };
  const quotationBase = {
    is_deleted: { $ne: true },
    isActive: { $ne: false },
    createdBy: { $in: memberIds },
  };

  const [
    totalLeads,
    newLeads7d,
    convertedLeads,
    openDeals,
    wonDeals,
    lostDeals,
    dealValueRows,
    stageBreakdown,
    totalClients,
    pendingFollowups,
    overdueFollowups,
    totalExpenses,
    pendingExpenses,
    totalQuotations,
    todayFollowups,
    memberPerformance,
  ] = await Promise.all([
    safeQuery("team totalLeads", 0, () => Lead.countDocuments(leadBase)),
    safeQuery("team newLeads7d", 0, () => Lead.countDocuments({ ...leadBase, created_at: { $gte: daysAgo(7) } })),
    safeQuery("team convertedLeads", 0, () => Lead.countDocuments(buildConvertedLeadMatch(leadBase))),
    safeQuery("team openDeals", 0, () => Deal.countDocuments(buildOpenDealMatch(dealBase))),
    safeQuery("team wonDeals", 0, () => Deal.countDocuments(buildWonDealMatch(dealBase))),
    safeQuery("team lostDeals", 0, () => Deal.countDocuments(buildLostDealMatch(dealBase))),
    safeQuery("team dealValueRows", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: null,
            totalPipelineValue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: ["$stage", CLOSED_VALUES] }] },
                      { $not: [{ $in: ["$status", ["won", "Won", "lost", "Lost"]] }] },
                    ],
                  },
                  { $ifNull: ["$dealValue", 0] },
                  0,
                ],
              },
            },
            totalWonValue: { $sum: 0 },
          },
        },
      ])
    ),
    safeQuery("team stageBreakdown", [], () =>
      Deal.aggregate([
        { $match: dealBase },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
    ),
    safeQuery("team totalClients", 0, () => Client.countDocuments(clientBase)),
    safeQuery("team pendingFollowups", 0, () => Followup.countDocuments(buildPendingFollowupMatch(followupBase))),
    safeQuery("team overdueFollowups", 0, () => Followup.countDocuments(buildOverdueFollowupMatch(followupBase))),
    safeQuery("team totalExpenses", 0, () => Expense.countDocuments(expenseBase)),
    safeQuery("team pendingExpenses", 0, () => Expense.countDocuments({ ...expenseBase, $or: [{ "approval.status": "pending" }, { status: "Pending" }] })),
    safeQuery("team totalQuotations", 0, () => Quotation.countDocuments(quotationBase)),
    safeQuery("team todayFollowups", 0, () => Followup.countDocuments(buildTodayFollowupMatch(buildPendingFollowupMatch(followupBase)))),
    safeQuery("team memberPerformance", [], async () => {
      const users = await User.find({
        _id: { $in: memberIdsStrings },
      })
        .select("name")
        .lean();

      const performanceMap = new Map();
      const rows = await Deal.aggregate([
        { $match: buildWonDealMatch(dealBase) },
        {
          $group: {
            _id: "$assignedTo",
            dealsWon: { $sum: 1 },
            valueWon: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
      ]);
      rows.forEach((r) => performanceMap.set(String(r._id), r));

      const leaderboard = users.map((u) => {
        const perf = performanceMap.get(String(u._id));
        return {
          userId: String(u._id),
          name: u.name || "Unknown",
          dealsWon: safeNumber(perf?.dealsWon),
          valueWon: safeNumber(perf?.valueWon),
        };
      });

      return leaderboard.sort((a, b) => b.valueWon - a.valueWon);
    }),
  ]);

  const totals = dealValueRows[0] || {};
  const wonValueRows = await safeQuery("team totalWonValue", [], () =>
    Deal.aggregate([
      { $match: buildWonDealMatch(dealBase) },
      {
        $group: {
          _id: null,
          totalWonValue: { $sum: { $ifNull: ["$dealValue", 0] } },
        },
      },
    ])
  );
  const wonTotals = wonValueRows[0] || {};
  const evidence = {
    scope: "team",
    role: "team",
    teamId: String(teamDoc?._id || ""),
    teamName: teamDoc?.name || teamDoc?.teamName || teamDoc?.title || "Team",
    managerName: managerName || "N/A",
    memberCount: memberIds.length,
    metrics: {
      teamLeads: totalLeads,
      newLeads7d,
      convertedLeads,
      openDeals,
      wonDeals,
      lostDeals,
      totalPipelineValue: safeNumber(totals.totalPipelineValue),
      totalWonValue: safeNumber(wonTotals.totalWonValue),
      totalClients,
      pendingFollowups,
      overdueFollowups,
      todayFollowups,
      totalExpenses,
      pendingExpenses,
      totalQuotations,
    },
    stageBreakdown: stageBreakdown.map((row) => ({
      stage: row?._id || "Unknown",
      count: safeNumber(row?.count),
      value: safeNumber(row?.value),
    })),
    memberPerformance,
    recentLeads: [],
  };

  console.log("[AI Insights Team Evidence]", {
    teamName: evidence.teamName,
    memberCount: memberIds.length,
    leads: totalLeads,
    openDeals,
    wonDeals,
    overdueFollowUps: overdueFollowups,
  });
  console.log("[AI Insights Evidence]", JSON.stringify(summarizeForLog(evidence), null, 2));
  return evidence;
}

async function getAIInsights(user, mode, teamId) {
  const role = await resolveRoleName(user?.role);
  let evidence;

  if (mode === "company") {
    evidence = await buildCompanyEvidence();
  } else if (mode === "team" && teamId) {
    evidence = await buildTeamEvidence(teamId);
  } else {
    evidence = await buildPersonalEvidence(user);
  }

  const fallbackInsights = buildOfflineInsights(evidence);
  const roleLabel = role === "admin" ? "Admin" : role === "manager" ? "Manager" : "User";
  const scopeLabel =
    mode === "company" ? "company-wide" : mode === "team" ? "team" : "personal";

  const insights = await safeQuery("gemini insights", fallbackInsights, async () => {
    const payload = await requestGeminiInsights(roleLabel, scopeLabel, evidence);
    return ensureInsightsShape(payload, fallbackInsights);
  });

  return {
    insights,
    evidence,
    generatedAt: new Date().toISOString(),
    teamName: evidence.teamName || "",
  };
}

module.exports = {
  getAIInsights,
  resolveRoleName,
  buildGlanceMetrics,
  getDateRange,
};
