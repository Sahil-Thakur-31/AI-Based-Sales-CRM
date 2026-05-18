const axios = require("axios");
const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Leads = require("../models/leads");
const Expense = require("../models/expenses");
const Client = require("../models/client");
const Followup = require("../models/followUp");
const SalesTarget = require("../models/sales_targets");
const Team = require("../models/teams");
const User = require("../models/users");
const Role = require("../models/roles");
const Source = require("../models/sources");

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const DEAL_METRICS = new Set([
  "revenue",
  "deal_count",
  "won_deals",
  "lost_deals",
  "lost_revenue",
  "win_rate",
  "avg_deal_size",
  "average_sales_cycle",
  "active_deals",
  "biggest_deals",
  "smallest_deals",
  "delayed_deals",
  "high_value_deals",
  "risk_deals",
  "stage_deals",
  "closing_this_month",
  "inactive_deal_value",
  "list_deals",
]);
const LEAD_METRICS = new Set(["lead_count", "list_leads", "converted_count", "non_converted_count", "uncontacted_count", "conversion_rate", "qualified_count", "deleted_leads", "inactive_leads"]);
const EXPENSE_METRICS = new Set(["expense_total", "expense_count", "approved_total", "pending_count", "rejected_count"]);
const CLIENT_METRICS = new Set(["top_clients_revenue", "inactive_clients"]);
const FOLLOWUP_METRICS = new Set(["todays_followups", "overdue_followups", "pending_meetings", "completed_meetings", "followup_count"]);
const USER_METRICS = new Set(["user_count", "active_users", "inactive_users", "deleted_users", "user_list"]);
const TEAM_METRICS = new Set(["team_targets", "team_count", "team_members", "team_list"]);

const DEAL_WON_STAGE = "P7";
const DEAL_LOST_STAGE = "P6";
const OPEN_DEAL_STAGE_FILTER = { $nin: [DEAL_WON_STAGE, DEAL_LOST_STAGE] };

const DEAL_GROUPS = new Set(["salesperson", "stage", "month", "size"]);
const LEAD_GROUPS = new Set(["source", "salesperson", "status", "month"]);
const EXPENSE_GROUPS = new Set(["category", "approval_status", "reference_type", "user", "month"]);
const CLIENT_GROUPS = new Set(["client", "month"]);
const FOLLOWUP_GROUPS = new Set(["employee", "stage", "status", "month"]);
const USER_GROUPS = new Set(["role", "team"]);
const TEAM_GROUPS = new Set(["team"]);

function isAdmin(role) {
  return String(role || "").toLowerCase() === "admin";
}

function isManager(role) {
  return String(role || "").toLowerCase() === "manager";
}

function normalizePeriod(period) {
  const value = String(period || "monthly").trim().toLowerCase();
  if (value === "quarterly" || value === "quarter") return "quarterly";
  if (value === "yearly" || value === "year") return "yearly";
  return "monthly";
}

function normalizeOptionalPeriod(period) {
  if (period === null || period === undefined) return null;
  const value = String(period).trim();
  if (!value) return null;
  return normalizePeriod(value);
}

function currentQuarterValue(date = new Date()) {
  const month = date.getMonth();
  if (month < 3) return "q1";
  if (month < 6) return "q2";
  if (month < 9) return "q3";
  return "q4";
}

function normalizeQuarter(quarter, now = new Date()) {
  const value = String(quarter || "").trim().toLowerCase();
  if (["q1", "q2", "q3", "q4"].includes(value)) return value;
  return currentQuarterValue(now);
}

function normalizeMonth(month, now = new Date()) {
  const parsed = Number.parseInt(month, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return now.getMonth() + 1;
  }
  return parsed;
}

function normalizeYear(year, now = new Date()) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 9999) {
    return now.getFullYear();
  }
  return parsed;
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function buildCurrentSelection(now = new Date()) {
  return {
    period: "monthly",
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    quarter: currentQuarterValue(now),
  };
}

function getSelectionRange(selection) {
  if (selection.period === "quarterly") {
    const quarterStartMap = { q1: 0, q2: 3, q3: 6, q4: 9 };
    const start = new Date(selection.year, quarterStartMap[selection.quarter], 1);
    return { start, end: addMonths(start, 3) };
  }

  if (selection.period === "yearly") {
    const start = new Date(selection.year, 0, 1);
    return { start, end: new Date(selection.year + 1, 0, 1) };
  }

  const start = new Date(selection.year, selection.month - 1, 1);
  return { start, end: addMonths(start, 1) };
}

function detectSelectionFromQuestion(question, options = {}) {
  const { allowFallback = true } = options;
  const now = new Date();
  const lower = String(question || "").toLowerCase();

  for (let index = 0; index < MONTH_NAMES.length; index += 1) {
    const name = MONTH_NAMES[index];
    const regex = new RegExp(`\\b${name}\\b(?:\\s+(\\d{4}))?`);
    const match = lower.match(regex);
    if (match) {
      return {
        period: "monthly",
        month: String(index + 1),
        year: String(match[1] ? Number.parseInt(match[1], 10) : now.getFullYear()),
        quarter: currentQuarterValue(now),
      };
    }
  }

  const quarterMatch = lower.match(/\bq([1-4])\b(?:\s+(\d{4}))?/);
  if (quarterMatch) {
    return {
      period: "quarterly",
      quarter: `q${quarterMatch[1]}`,
      year: String(quarterMatch[2] ? Number.parseInt(quarterMatch[2], 10) : now.getFullYear()),
      month: String(now.getMonth() + 1),
    };
  }

  if (lower.includes("last month")) {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      period: "monthly",
      month: String(previous.getMonth() + 1),
      year: String(previous.getFullYear()),
      quarter: currentQuarterValue(previous),
    };
  }

  if (lower.includes("this month") || lower.includes("current month")) {
    return buildCurrentSelection(now);
  }

  if (lower.includes("this quarter") || lower.includes("current quarter")) {
    return {
      period: "quarterly",
      quarter: currentQuarterValue(now),
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
    };
  }

  if (lower.includes("quarterly")) {
    return {
      period: "quarterly",
      quarter: currentQuarterValue(now),
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
    };
  }

  if (lower.includes("last quarter")) {
    const previous = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    return {
      period: "quarterly",
      quarter: currentQuarterValue(previous),
      year: String(previous.getFullYear()),
      month: String(previous.getMonth() + 1),
    };
  }

  if (lower.includes("last year")) {
    return {
      period: "yearly",
      year: String(now.getFullYear() - 1),
      month: String(now.getMonth() + 1),
      quarter: currentQuarterValue(now),
    };
  }

  if (lower.includes("this year") || lower.includes("current year")) {
    return {
      period: "yearly",
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      quarter: currentQuarterValue(now),
    };
  }

  if (lower.includes("yearly")) {
    return {
      period: "yearly",
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      quarter: currentQuarterValue(now),
    };
  }

  if (lower.includes("monthly")) {
    return buildCurrentSelection(now);
  }

  if (!allowFallback) return null;
  return buildCurrentSelection(now);
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeIntentText(value) {
  let text = normalizeMatchText(value);
  if (!text) return "";

  const replacements = [
    [/\bfollow[\s-]*ups?\b/g, "followup"],
    [/\bfollowups?\b/g, "followup"],
    [/\bfollows?\b/g, "followup"],
    [/\bfolowups?\b/g, "followup"],
    [/\bfolows?\b/g, "followup"],
    [/\bmeetings?\b/g, "meeting"],
    [/\bemployees?\b/g, "user"],
    [/\bsales people\b/g, "salesperson"],
    [/\bsalespeople\b/g, "salesperson"],
    [/\bsales persons?\b/g, "salesperson"],
    [/\bsales reps?\b/g, "salesperson"],
    [/\breps?\b/g, "salesperson"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, " ").trim();
}

function tokenizeIntentText(value) {
  return canonicalizeIntentText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshteinDistance(a = "", b = "") {
  const left = String(a);
  const right = String(b);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function areSimilarIntentTokens(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 4 || b.length <= 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) {
    return Math.min(a.length, b.length) >= 5;
  }

  const distance = levenshteinDistance(a, b);
  if (Math.min(a.length, b.length) >= 7) return distance <= 2;
  if (Math.min(a.length, b.length) >= 5) return distance <= 1;
  return false;
}

function semanticIncludes(text, pattern) {
  const canonicalText = canonicalizeIntentText(text);
  const canonicalPattern = canonicalizeIntentText(pattern);
  if (!canonicalText || !canonicalPattern) return false;
  if (canonicalText.includes(canonicalPattern)) return true;

  const questionTokens = tokenizeIntentText(canonicalText);
  const patternTokens = tokenizeIntentText(canonicalPattern);
  if (!questionTokens.length || !patternTokens.length) return false;

  return patternTokens.every((patternToken) =>
    questionTokens.some((questionToken) => areSimilarIntentTokens(questionToken, patternToken))
  );
}

function detectUnsupportedReason(question) {
  const lower = String(question || "").toLowerCase();

  if (/\b(why|reason|recommend|suggest|improve|best strategy|what should)\b/.test(lower)) {
    return "Advisory questions are not supported in custom report mode yet.";
  }

  if (/\b(predict|forecast|future|next month|next quarter|next year)\b/.test(lower)) {
    return "Prediction questions are not supported in custom report mode yet.";
  }

  if (/\b(industry|sector)\b/.test(lower)) {
    return "Industry grouping is not supported in the current custom report MVP.";
  }

  if (/\b(city|state)\b/.test(lower)) {
    return "City and state reporting are not supported in the current custom report MVP.";
  }

  if (/\b(team revenue comparison|leaderboard|target achievement|win rate employee|conversion rate employee|repeat customer|roi)\b/.test(lower)) {
    return "That report type is planned for a later phase and is not supported yet.";
  }

  if (/\b(without follow up|without follow-up|no follow up|no follow-up|which deals may close soon)\b/.test(lower)) {
    return "That report type needs additional relationship logic and is not supported yet.";
  }

  if (/\b(last 3 months|last three months|last 6 months|last six months)\b/.test(lower)) {
    return "Use monthly, quarterly, or yearly periods in custom reports.";
  }

  return "";
}

function hasSupportedIntent(question) {
  return containsAny(question, [
    "top performer",
    "best performer",
    "top rep",
    "revenue",
    "sales",
    "win rate",
    "average deal",
    "won deal",
    "lost deal",
    "pipeline",
    "stage",
    "deal count",
    "lead count",
    "lead",
    "uncontacted",
    "qualified",
    "converted lead",
    "conversion",
    "expense",
    "spend",
    "approved",
    "pending",
    "rejected",
    "category",
    "source",
    "followup",
    "meeting",
    "client",
    "user",
    "employee",
    "role",
    "team",
    "target",
  ]);
}

async function detectSourceFilter(question) {
  const normalizedQuestion = normalizeMatchText(question);
  if (!normalizedQuestion) return [];

  const sources = await Source.find({})
    .select("_id name")
    .lean();

  return sources.filter((source) => {
    const normalizedSource = normalizeMatchText(source?.name);
    return normalizedSource && normalizedQuestion.includes(normalizedSource);
  });
}

function containsAny(text, patterns = []) {
  return patterns.some((pattern) => semanticIncludes(text, pattern));
}

function wantsAllRows(text) {
  return containsAny(text, [
    "all",
    "show all",
    "list all",
    "all rows",
    "all records",
  ]);
}

function hasExplicitCountIntent(text) {
  return containsAny(text, [
    "total",
    "count",
    "number of",
    "how many",
  ]);
}

function hasExplicitListIntent(text) {
  return containsAny(text, [
    "list",
    "show all",
    "show leads",
    "show users",
    "show teams",
    "show deals",
  ]);
}

function hasRankingIntent(question) {
  const text = canonicalizeIntentText(question);
  return containsAny(text, [
    "top performer",
    "best performer",
    "lowest performing",
    "biggest deal",
    "smallest deal",
    "high value deal",
    "top client",
    "top clients",
  ]);
}

function shouldExpandAllTimeLimit(question, plan = {}) {
  if (plan?.period) return false;
  if (hasRankingIntent(question)) return false;
  return true;
}

function minDate(left, right) {
  const leftDate = left instanceof Date ? left : new Date(left);
  const rightDate = right instanceof Date ? right : new Date(right);
  return leftDate.getTime() <= rightDate.getTime() ? leftDate : rightDate;
}

function makePlan(selection, module, metric, overrides = {}) {
  return {
    module,
    metric,
    groupBy: null,
    period: selection?.period || null,
    month: selection?.month || null,
    quarter: selection?.quarter || null,
    year: selection?.year || null,
    filters: {},
    sort: { by: "label", order: "asc" },
    limit: 25,
    chartType: "table",
    ...overrides,
  };
}

async function buildDeterministicPlan(question) {
  const unsupportedReason = detectUnsupportedReason(question);
  if (unsupportedReason) {
    return { unsupported: true, reason: unsupportedReason, hardUnsupported: true };
  }

  const lower = canonicalizeIntentText(question);
  const selection = detectSelectionFromQuestion(question, { allowFallback: false });

  if (containsAny(lower, ["teams and their targets", "team targets", "teams targets", "what are teams and their targets"])) {
    return makePlan(selection, "teams", "team_targets", {
      chartType: "table",
      limit: 50,
    });
  }

  if (containsAny(lower, ["team count", "total teams"])) {
    return makePlan(selection, "teams", "team_count");
  }

  if (containsAny(lower, ["show all teams", "list all teams", "show teams", "list teams", "team list", "what are teams"])) {
    return makePlan(selection, "teams", "team_list", {
      chartType: "table",
      limit: 500,
    });
  }

  if (containsAny(lower, ["team members", "members by team"])) {
    return makePlan(selection, "teams", "team_members", {
      chartType: "table",
      limit: 500,
    });
  }

  if (containsAny(lower, ["show users", "list users", "user list", "employees list", "show all users", "list all users"])) {
    return makePlan(selection, "users", "user_list", {
      chartType: "table",
      limit: 500,
    });
  }

  if (containsAny(lower, ["active users", "active employees"])) {
    return makePlan(selection, "users", "active_users");
  }

  if (containsAny(lower, ["inactive users", "inactive employees"])) {
    return makePlan(selection, "users", "inactive_users");
  }

  if (containsAny(lower, ["deleted users", "deleted employees"])) {
    return makePlan(selection, "users", "deleted_users");
  }

  if (containsAny(lower, ["users by role", "employees by role", "user roles"])) {
    return makePlan(selection, "users", "user_count", {
      groupBy: "role",
      chartType: "bar",
    });
  }

  if (containsAny(lower, ["users by team", "employees by team"])) {
    return makePlan(selection, "users", "user_count", {
      groupBy: "team",
      chartType: "bar",
    });
  }

  if (containsAny(lower, ["total users", "user count", "total employees", "employee count"])) {
    return makePlan(selection, "users", "user_count");
  }

  if (containsAny(lower, ["today's follow", "todays follow", "today follow"])) {
    return makePlan(selection, "followups", "todays_followups", {
      limit: wantsAllRows(lower) ? 500 : 25,
    });
  }

  if (lower.includes("overdue follow")) {
    return makePlan(selection, "followups", "overdue_followups", {
      limit: wantsAllRows(lower) ? 500 : 25,
    });
  }

  if (lower.includes("pending meeting")) {
    return makePlan(selection, "followups", "pending_meetings", {
      limit: wantsAllRows(lower) ? 500 : 25,
    });
  }

  if (lower.includes("completed meeting")) {
    return makePlan(selection, "followups", "completed_meetings", {
      limit: wantsAllRows(lower) ? 500 : 25,
    });
  }

  if (containsAny(lower, ["follow-ups by employee", "followups by employee", "follow up by employee"])) {
    return makePlan(selection, "followups", "followup_count", {
      groupBy: "employee",
      chartType: "bar",
    });
  }

  if (containsAny(lower, ["follow-up count", "followup count", "follow ups", "follow-ups", "followups", "follows"])) {
    return makePlan(selection, "followups", "followup_count");
  }

  if (containsAny(lower, ["top clients", "top client"])) {
    return makePlan(selection, "clients", "top_clients_revenue", {
      sort: { by: "value", order: "desc" },
      limit: 10,
      chartType: "bar",
    });
  }

  if (lower.includes("inactive client")) {
    return makePlan(selection, "clients", "inactive_clients");
  }

  if (containsAny(lower, ["expense trend", "monthly expenses"])) {
    return makePlan(selection, "expenses", "expense_total", {
      groupBy: "month",
      chartType: "line",
    });
  }

  if (containsAny(lower, ["expenses by category", "expense by category"])) {
    return makePlan(selection, "expenses", "expense_total", {
      groupBy: "category",
      chartType: "bar",
    });
  }

  if (containsAny(lower, ["employee expenses", "expenses by employee", "expenses by user"])) {
    return makePlan(selection, "expenses", "expense_total", {
      groupBy: "user",
      chartType: "bar",
    });
  }

  if (lower.includes("approved expense")) {
    return makePlan(selection, "expenses", "approved_total");
  }

  if (lower.includes("pending expense")) {
    return makePlan(selection, "expenses", "pending_count");
  }

  if (lower.includes("rejected expense")) {
    return makePlan(selection, "expenses", "rejected_count");
  }

  if (containsAny(lower, ["total expenses", "total expense", "expenses", "expense", "spend"])) {
    return makePlan(selection, "expenses", "expense_total");
  }

  if (lower.includes("deleted lead")) {
    return makePlan(selection, "leads", "deleted_leads");
  }

  if (lower.includes("inactive lead")) {
    return makePlan(selection, "leads", "inactive_leads");
  }

  if (containsAny(lower, ["leads assigned to me", "lead assigned to me"])) {
    return makePlan(selection, "leads", "list_leads", {
      filters: { assigned_to_me: true },
      chartType: "table",
      limit: wantsAllRows(lower) ? 500 : 100,
    });
  }

  if (containsAny(lower, ["leads by source"])) {
    return makePlan(selection, "leads", "lead_count", {
      groupBy: "source",
      chartType: "bar",
    });
  }

  if (lower.includes("uncontacted lead")) {
    return makePlan(selection, "leads", "uncontacted_count");
  }

  if (containsAny(lower, ["non converted leads", "non converted lead", "not converted leads", "not converted lead", "unconverted leads", "unconverted lead"])) {
    return makePlan(selection, "leads", "non_converted_count");
  }

  if (containsAny(lower, ["lead conversion rate", "converted leads", "converted lead"])) {
    return makePlan(selection, "leads", lower.includes("conversion rate") ? "conversion_rate" : "converted_count");
  }

  if (containsAny(lower, ["new leads this month"])) {
    return makePlan(
      {
        ...(selection || buildCurrentSelection()),
        period: "monthly",
      },
      "leads",
      "lead_count"
    );
  }

  if (containsAny(lower, ["new leads"])) {
    return makePlan(selection, "leads", "lead_count");
  }

  if (
    containsAny(lower, [
      "show all leads",
      "list all leads",
      "list leads",
      "show leads",
      "leads this month",
      "this month leads",
      "leads this quarter",
      "this quarter leads",
      "leads this year",
      "this year leads",
    ]) &&
    !hasExplicitCountIntent(lower)
  ) {
    const plan = makePlan(selection, "leads", "list_leads", {
      chartType: "table",
      limit: wantsAllRows(lower) ? 500 : 100,
    });
    const matchedSources = await detectSourceFilter(question);
    if (matchedSources.length === 1 && !lower.includes("by source")) {
      plan.filters.sourceIds = [String(matchedSources[0]._id)];
    }
    return plan;
  }

  if (containsAny(lower, ["total leads", "lead count"])) {
    const plan = makePlan(selection, "leads", "lead_count");
    const matchedSources = await detectSourceFilter(question);
    if (matchedSources.length === 1 && !lower.includes("by source")) {
      plan.filters.sourceIds = [String(matchedSources[0]._id)];
    }
    return plan;
  }

  if (containsAny(lower, ["monthly revenue trend", "quarterly revenue trend", "revenue trend", "monthly revenue", "sales trend", "monthly sales trend", "quarterly sales trend"])) {
    return makePlan(selection, "deals", "revenue", {
      groupBy: "month",
      chartType: "line",
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  if (containsAny(lower, ["yearly revenue growth"])) {
    return makePlan(
      {
        ...(selection || buildCurrentSelection()),
        period: "yearly",
      },
      "deals",
      "revenue",
      {
        groupBy: "month",
        chartType: "line",
        filters: { stage: DEAL_WON_STAGE },
      }
    );
  }

  if (containsAny(lower, ["revenue by salesperson", "revenue by employee", "sales by salesperson", "sales by employee", "sales by user"])) {
    return makePlan(selection, "deals", "revenue", {
      groupBy: "salesperson",
      chartType: "bar",
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  if (containsAny(lower, ["top sales performers", "top performers", "best performing employee", "top closer", "best sales people", "top salespeople"])) {
    return makePlan(selection, "deals", "revenue", {
      groupBy: "salesperson",
      chartType: "bar",
      filters: { stage: DEAL_WON_STAGE },
      sort: { by: "value", order: "desc" },
      limit: 10,
    });
  }

  if (containsAny(lower, ["lowest performing", "lowest performers", "lowest performing salespeople"])) {
    return makePlan(selection, "deals", "revenue", {
      groupBy: "salesperson",
      chartType: "bar",
      filters: { stage: DEAL_WON_STAGE },
      sort: { by: "value", order: "asc" },
      limit: 10,
    });
  }

  if (lower.includes("average deal size")) {
    return makePlan(selection, "deals", "avg_deal_size", {
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  if (containsAny(lower, ["biggest deal", "biggest deals"])) {
    return makePlan(selection, "deals", "biggest_deals", {
      sort: { by: "value", order: "desc" },
      limit: 10,
    });
  }

  if (containsAny(lower, ["show all deals", "list all deals", "list this month deals", "list deals this month", "list deals"])) {
    return makePlan(selection, "deals", "list_deals", {
      chartType: "table",
      limit: 500,
      filters: {
        all_records: containsAny(lower, ["show all deals", "list all deals"]),
      },
    });
  }

  if (containsAny(lower, ["smallest deal", "smallest deals"])) {
    return makePlan(selection, "deals", "smallest_deals", {
      sort: { by: "value", order: "asc" },
      limit: 10,
    });
  }

  if (lower.includes("won revenue")) {
    return makePlan(selection, "deals", "revenue", {
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  if (lower.includes("lost revenue")) {
    return makePlan(selection, "deals", "lost_revenue", {
      filters: { stage: DEAL_LOST_STAGE },
    });
  }

  if (lower.includes("inactive deal value")) {
    return makePlan(selection, "deals", "inactive_deal_value");
  }

  if (lower.includes("active deals")) {
    return makePlan(selection, "deals", "active_deals");
  }

  if (lower.includes("won deals")) {
    return makePlan(selection, "deals", "won_deals");
  }

  if (lower.includes("lost deals")) {
    return makePlan(selection, "deals", "lost_deals");
  }

  if (containsAny(lower, ["deals by stage", "deal stages"])) {
    return makePlan(selection, "deals", "deal_count", {
      groupBy: "stage",
      chartType: "bar",
    });
  }

  const stuckStageMatch = lower.match(/\bstuck in (p[1237])\b/);
  if (stuckStageMatch) {
    return makePlan(selection, "deals", "stage_deals", {
      filters: { stage: stuckStageMatch[1].toUpperCase() },
      limit: 25,
    });
  }

  if (containsAny(lower, ["deals closing this month", "closing this month"])) {
    return makePlan(selection, "deals", "closing_this_month", {
      period: "monthly",
      month: String(new Date().getMonth() + 1),
      year: String(new Date().getFullYear()),
    });
  }

  if (lower.includes("delayed deals")) {
    return makePlan(selection, "deals", "delayed_deals", {
      limit: 25,
    });
  }

  if (lower.includes("high value deals")) {
    return makePlan(selection, "deals", "high_value_deals", {
      sort: { by: "value", order: "desc" },
      limit: 25,
    });
  }

  if (containsAny(lower, ["deal distribution by size", "deal size distribution"])) {
    return makePlan(selection, "deals", "deal_count", {
      groupBy: "size",
      chartType: "bar",
    });
  }

  if (containsAny(lower, ["average sales cycle", "sales cycle"])) {
    return makePlan(selection, "deals", "average_sales_cycle", {
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  if (lower.includes("risk deals")) {
    return makePlan(selection, "deals", "risk_deals", {
      sort: { by: "value", order: "desc" },
      limit: 25,
    });
  }

  if (containsAny(lower, ["total deals", "deal count", "show deals", "sales deals"])) {
    return makePlan(selection, "deals", "deal_count");
  }

  if (containsAny(lower, ["total revenue", "show revenue", "revenue this month", "revenue this year", "sales revenue", "sales this month", "sales this year", "year sales revenue", "this year sales revenue"])) {
    return makePlan(selection, "deals", "revenue", {
      filters: { stage: DEAL_WON_STAGE },
    });
  }

  return { unsupported: true, reason: "Unsupported or ambiguous question." };
}

function buildHeuristicPlan(question) {
  const lower = canonicalizeIntentText(question);
  const selection = detectSelectionFromQuestion(question, { allowFallback: false });
  const topPerformerIntent =
    lower.includes("top performer") ||
    lower.includes("best performer") ||
    lower.includes("top rep") ||
    lower.includes("top salesperson");

  let module = "deals";
  if (/(expense|spend|approved expense|pending expense|rejected expense)/.test(lower)) {
    module = "expenses";
  } else if (/(lead|source|uncontacted|qualified|converted lead|non converted|not converted|unconverted)/.test(lower)) {
    module = "leads";
  } else if (/(follow[-\s]?up|followup|follows|meeting)/.test(lower)) {
    module = "followups";
  } else if (/(team|target)/.test(lower)) {
    module = "teams";
  } else if (/(user|employee|role)/.test(lower)) {
    module = "users";
  } else if (/(client)/.test(lower)) {
    module = "clients";
  }

  const filters = {};
  let metric = "deal_count";
  let groupBy = null;

  if (module === "deals") {
    if (topPerformerIntent) {
      metric = "revenue";
      groupBy = "salesperson";
      filters.stage = DEAL_WON_STAGE;
    } else if (lower.includes("win rate")) {
      metric = "win_rate";
      groupBy = lower.includes("salesperson") || lower.includes("rep") ? "salesperson" : null;
    } else if (lower.includes("average deal")) {
      metric = "avg_deal_size";
      filters.stage = DEAL_WON_STAGE;
      groupBy = lower.includes("salesperson") ? "salesperson" : null;
    } else if (lower.includes("revenue")) {
      metric = "revenue";
      filters.stage = DEAL_WON_STAGE;
      if (lower.includes("salesperson") || lower.includes("rep")) groupBy = "salesperson";
      else if (lower.includes("stage")) groupBy = "stage";
      else if (lower.includes("status")) groupBy = "stage";
      else if (lower.includes("trend") || lower.includes("month")) groupBy = "month";
    } else if (lower.includes("lost")) {
      metric = "lost_deals";
      filters.stage = DEAL_LOST_STAGE;
      groupBy = lower.includes("salesperson") ? "salesperson" : null;
    } else if (lower.includes("won")) {
      metric = "won_deals";
      filters.stage = DEAL_WON_STAGE;
      groupBy = lower.includes("salesperson") ? "salesperson" : null;
    } else {
      metric = "deal_count";
      if (lower.includes("pipeline") || lower.includes("stage")) groupBy = "stage";
      else if (lower.includes("salesperson") || lower.includes("rep")) groupBy = "salesperson";
      else if (lower.includes("status")) groupBy = "stage";
    }
  }

  if (module === "leads") {
    if (lower.includes("uncontacted")) {
      metric = "uncontacted_count";
      groupBy = lower.includes("source") ? "source" : lower.includes("salesperson") ? "salesperson" : null;
    } else if (lower.includes("non converted") || lower.includes("not converted") || lower.includes("unconverted")) {
      metric = "non_converted_count";
      groupBy = lower.includes("source") ? "source" : lower.includes("salesperson") ? "salesperson" : null;
    } else if (lower.includes("conversion")) {
      metric = "conversion_rate";
      groupBy = lower.includes("source") ? "source" : lower.includes("salesperson") ? "salesperson" : null;
    } else if (lower.includes("qualified")) {
      metric = "qualified_count";
      filters.status = "qualified";
      groupBy = lower.includes("salesperson") ? "salesperson" : lower.includes("source") ? "source" : null;
    } else if (lower.includes("converted")) {
      metric = "converted_count";
      groupBy = lower.includes("source") ? "source" : lower.includes("salesperson") ? "salesperson" : null;
    } else {
      metric = hasExplicitCountIntent(lower) ? "lead_count" : "list_leads";
      if (lower.includes("source")) groupBy = "source";
      else if (lower.includes("salesperson") || lower.includes("rep")) groupBy = "salesperson";
      else if (lower.includes("status")) groupBy = "status";
    }
    if (lower.includes("source")) {
      groupBy = lower.includes("by source") ? "source" : groupBy;
    }
  }

  if (module === "expenses") {
    if (lower.includes("approved")) {
      metric = "approved_total";
      filters.approval_status = "approved";
    } else if (lower.includes("pending")) {
      metric = "pending_count";
      filters.approval_status = "pending";
    } else if (lower.includes("rejected")) {
      metric = "rejected_count";
      filters.approval_status = "rejected";
    } else if (lower.includes("total expense") || lower.includes("expenses") || lower.includes("spend")) {
      metric = "expense_total";
    } else {
      metric = "expense_count";
    }

    if (lower.includes("category")) groupBy = "category";
    else if (lower.includes("approval")) groupBy = "approval_status";
    else if (lower.includes("reference")) groupBy = "reference_type";
    else if (lower.includes("user") || lower.includes("employee")) groupBy = "user";
    else if (lower.includes("trend") || lower.includes("month")) groupBy = "month";
  }

  if (module === "clients") {
    metric = lower.includes("inactive") ? "inactive_clients" : "top_clients_revenue";
    if (lower.includes("month") || lower.includes("trend")) groupBy = "month";
    else if (lower.includes("client") && lower.includes("top")) groupBy = "client";
  }

  if (module === "followups") {
    if (lower.includes("today")) {
      metric = "todays_followups";
    } else if (lower.includes("overdue")) {
      metric = "overdue_followups";
    } else if (lower.includes("pending") && lower.includes("meeting")) {
      metric = "pending_meetings";
    } else if (lower.includes("completed") && lower.includes("meeting")) {
      metric = "completed_meetings";
    } else {
      metric = "followup_count";
    }

    if (lower.includes("employee")) groupBy = "employee";
    else if (lower.includes("stage")) groupBy = "stage";
    else if (lower.includes("status")) groupBy = "status";
    else if (lower.includes("trend") || lower.includes("month")) groupBy = "month";
  }

  if (module === "users") {
    if (lower.includes("list") || lower.includes("show users") || lower.includes("show employees")) {
      metric = "user_list";
    } else if (lower.includes("active")) {
      metric = "active_users";
    } else if (lower.includes("inactive")) {
      metric = "inactive_users";
    } else if (lower.includes("deleted")) {
      metric = "deleted_users";
    } else {
      metric = "user_count";
    }

    if (metric === "user_count") {
      if (lower.includes("role")) groupBy = "role";
      else if (lower.includes("team")) groupBy = "team";
    }
  }

  if (module === "teams") {
    if (lower.includes("member")) {
      metric = "team_members";
    } else if (lower.includes("list") || lower.includes("show teams")) {
      metric = "team_list";
    } else if (lower.includes("count") || lower.includes("total teams")) {
      metric = "team_count";
    } else {
      metric = "team_targets";
    }

    if (lower.includes("by team")) groupBy = "team";
  }

  return {
    module,
    metric,
    groupBy,
    period: selection?.period || null,
    month: selection?.month || null,
    quarter: selection?.quarter || null,
    year: selection?.year || null,
    filters,
    sort: topPerformerIntent ? { by: "value", order: "desc" } : { by: "label", order: "asc" },
    limit: wantsAllRows(lower) ? 500 : topPerformerIntent ? 10 : 25,
    chartType: groupBy === "month" ? "line" : groupBy ? "bar" : "table",
  };
}

function cleanJsonText(value) {
  const text = String(value || "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return "{}";
  return text.slice(first, last + 1);
}

async function askGeminiForPlan(question) {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `
You are a CRM reporting assistant for a sales CRM.

Convert the user's question into valid JSON only.

Allowed modules:
- deals
- leads
- expenses
- users
- teams
- clients
- followups

Allowed metrics:
Deals:
- revenue
- deal_count
- won_deals
- lost_deals
- lost_revenue
- win_rate
- avg_deal_size
- average_sales_cycle
- active_deals
- biggest_deals
- smallest_deals
- delayed_deals
- high_value_deals
- risk_deals
- stage_deals
- closing_this_month
- inactive_deal_value
- list_deals

Leads:
- lead_count
- list_leads
- converted_count
- non_converted_count
- uncontacted_count
- conversion_rate
- qualified_count
- deleted_leads
- inactive_leads

Expenses:
- expense_total
- expense_count
- approved_total
- pending_count
- rejected_count

Clients:
- top_clients_revenue
- inactive_clients

Followups:
- todays_followups
- overdue_followups
- pending_meetings
- completed_meetings
- followup_count

Users:
- user_count
- active_users
- inactive_users
- deleted_users
- user_list

Teams:
- team_targets
- team_count
- team_members
- team_list

Allowed groupBy values:
Deals:
- salesperson
- stage
- month
- size

Leads:
- source
- salesperson
- status
- month

Expenses:
- category
- approval_status
- reference_type
- user
- month

Clients:
- client
- month

Followups:
- employee
- stage
- status
- month

Users:
- role
- team

Teams:
- team

Allowed period values:
- monthly
- quarterly
- yearly

Allowed filters:
- status
- salesperson
- source
- stage
- category
- approval_status
- reference_type
- assigned_to_me
- sourceIds
- all_records

Rules:
- Return JSON only.
- Do not return explanation text.
- If the user asks for top performers, default to module=deals, metric=revenue, groupBy=salesperson, filters.stage=P7.
- If the user asks for conversion, use leads unless they clearly mention deals.
- If the user asks for non-converted leads, not-converted leads, or unconverted leads, use module=leads and metric=non_converted_count.
- If the user asks for revenue, use deals and filters.stage=P7.
- If the user asks for expenses/spend, use expenses.
- If the user asks for follow-ups, followups, follows, or meetings, use followups.
- If the user asks for users or employees, use users.
- If the user asks for teams or targets, use teams.
- If the user asks for clients, use clients.
- If the user asks only for leads plus a time period like "this month leads", prefer module=leads and metric=list_leads.
- If the user explicitly asks for total/count/number of leads, use module=leads and metric=lead_count.
- If the user asks only for a module plus a time period, infer the default count/list metric for that module.
- Default metrics by simple question:
  leads -> list_leads
  deals -> deal_count
  expenses -> expense_total
  followups -> followup_count
  users -> user_count
  teams -> team_count
  clients -> top_clients_revenue
- If the question says "this month", "current month", "this quarter", or "this year", include the correct period.
- Period is optional. Omit period/month/quarter/year when the user did not ask for a time range.
- If the question is unsupported, return:
  {"unsupported": true, "reason": "short reason"}

Examples:
{"question":"leads this month","module":"leads","metric":"list_leads","period":"monthly"}
{"question":"this month follows","module":"followups","metric":"followup_count","period":"monthly"}
{"question":"show users","module":"users","metric":"user_list"}
{"question":"teams this year","module":"teams","metric":"team_count","period":"yearly"}
{"question":"top clients this quarter","module":"clients","metric":"top_clients_revenue","period":"quarterly"}

User question:
"${String(question || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
`.trim();

  const responseSchema = {
    type: "object",
    properties: {
      unsupported: { type: "boolean" },
      reason: { type: "string" },
      module: { type: "string", enum: ["deals", "leads", "expenses", "users", "teams", "clients", "followups"] },
      metric: { type: "string" },
      groupBy: { type: "string" },
      period: { type: "string" },
      month: { type: "string" },
      quarter: { type: "string" },
      year: { type: "string" },
      filters: {
        type: "object",
        additionalProperties: true,
      },
      sort: {
        type: "object",
        properties: {
          by: { type: "string" },
          order: { type: "string" },
        },
        additionalProperties: false,
      },
      limit: { type: "integer" },
      chartType: { type: "string" },
    },
    required: ["module", "metric"],
    additionalProperties: false,
  };

  const model =
    process.env.GEMINI_REPORT_MODEL ||
    process.env.OPENAI_REPORT_MODEL ||
    "gemini-2.5-flash";
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const content =
    response?.data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || "{}";
  return JSON.parse(cleanJsonText(content));
}

function normalizePlan(rawPlan, fallbackQuestion) {
  const fallback = buildHeuristicPlan(fallbackQuestion);
  const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const normalizedPeriod = normalizeOptionalPeriod(
    plan.period !== undefined ? plan.period : fallback.period
  );
  const normalized = {
    module: ["deals", "leads", "expenses", "clients", "followups", "teams", "users"].includes(plan.module) ? plan.module : fallback.module,
    metric: String(plan.metric || fallback.metric),
    groupBy: plan.groupBy || fallback.groupBy || null,
    period: normalizedPeriod,
    month: normalizedPeriod ? String(normalizeMonth(plan.month || fallback.month)) : null,
    quarter: normalizedPeriod ? normalizeQuarter(plan.quarter || fallback.quarter) : null,
    year: normalizedPeriod ? String(normalizeYear(plan.year || fallback.year)) : null,
    filters: plan.filters && typeof plan.filters === "object" ? plan.filters : fallback.filters,
    sort: plan.sort && typeof plan.sort === "object" ? plan.sort : fallback.sort,
    limit: Number.isFinite(Number(plan.limit)) ? Number(plan.limit) : fallback.limit,
    chartType: plan.chartType || fallback.chartType,
  };

    if (normalized.module === "deals" && !DEAL_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "deals" ? fallback.metric : "deal_count";
    if (normalized.module === "leads" && !LEAD_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "leads" ? fallback.metric : "lead_count";
    if (normalized.module === "expenses" && !EXPENSE_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "expenses" ? fallback.metric : "expense_total";
    if (normalized.module === "clients" && !CLIENT_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "clients" ? fallback.metric : "top_clients_revenue";
    if (normalized.module === "followups" && !FOLLOWUP_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "followups" ? fallback.metric : "todays_followups";
    if (normalized.module === "users" && !USER_METRICS.has(normalized.metric)) normalized.metric = fallback.module === "users" ? fallback.metric : "user_count";
    if (normalized.module === "teams" && !TEAM_METRICS.has(normalized.metric)) normalized.metric = "team_targets";

  if (normalized.module === "deals" && normalized.groupBy && !DEAL_GROUPS.has(normalized.groupBy)) normalized.groupBy = fallback.groupBy && DEAL_GROUPS.has(fallback.groupBy) ? fallback.groupBy : null;
  if (normalized.module === "leads" && normalized.groupBy && !LEAD_GROUPS.has(normalized.groupBy)) normalized.groupBy = fallback.groupBy && LEAD_GROUPS.has(fallback.groupBy) ? fallback.groupBy : null;
    if (normalized.module === "expenses" && normalized.groupBy && !EXPENSE_GROUPS.has(normalized.groupBy)) normalized.groupBy = fallback.groupBy && EXPENSE_GROUPS.has(fallback.groupBy) ? fallback.groupBy : null;
    if (normalized.module === "clients" && normalized.groupBy && !CLIENT_GROUPS.has(normalized.groupBy)) normalized.groupBy = null;
    if (normalized.module === "followups" && normalized.groupBy && !FOLLOWUP_GROUPS.has(normalized.groupBy)) normalized.groupBy = null;
    if (normalized.module === "users" && normalized.groupBy && !USER_GROUPS.has(normalized.groupBy)) normalized.groupBy = null;
    if (normalized.module === "teams" && normalized.groupBy && !TEAM_GROUPS.has(normalized.groupBy)) normalized.groupBy = null;

  const expandAllTimeLimit = shouldExpandAllTimeLimit(fallbackQuestion, normalized);
  if (expandAllTimeLimit && Number(normalized.limit || 0) === 25) {
    normalized.limit = 1000;
  }
  normalized.limit = Math.max(1, Math.min(normalized.limit || 25, expandAllTimeLimit ? 1000 : 50));
  normalized.chartType = normalized.groupBy === "month" ? "line" : normalized.groupBy ? "bar" : "table";

  return normalized;
}

async function getScopedUserIds(user = {}) {
  if (!user?._id) return [];
  if (isAdmin(user.role)) return [];
  if (!isManager(user.role)) return [String(user._id)];

  const teams = await Team.find({ "teamLeads.userId": user._id })
    .select("teamLeads members")
    .lean();

  return [...new Set([
    String(user._id),
    ...teams.flatMap((team) => [
      ...(team.teamLeads || []).map((lead) => String(lead.userId || "")),
      ...(team.members || []).map((member) => String(member.userId || "")),
    ]),
  ].filter(Boolean))];
}

async function resolveReportUserContext(user = {}) {
  if (!user?._id || !mongoose.Types.ObjectId.isValid(String(user._id))) {
    return {
      _id: user?._id || null,
      email: user?.email || "",
      role: String(user?.role || "").toLowerCase(),
    };
  }

  const dbUser = await User.findById(user._id)
    .populate("role", "name")
    .select("_id email role")
    .lean();

  const roleName =
    String(dbUser?.role?.name || user?.role || "")
      .trim()
      .toLowerCase();

  return {
    _id: dbUser?._id || user._id,
    email: dbUser?.email || user?.email || "",
    role: roleName,
  };
}

async function mapUserLabels(ids = []) {
  const validIds = [...new Set(ids.filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (!validIds.length) return new Map();
  const users = await User.find({ _id: { $in: validIds } })
    .select("name email")
    .lean();
  return new Map(users.map((user) => [String(user._id), user.name || user.email || "User"]));
}

async function mapSourceLabels(ids = []) {
  const validIds = [...new Set(ids.filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (!validIds.length) return new Map();
  const sources = await Source.find({ _id: { $in: validIds } })
    .select("name")
    .lean();
  return new Map(sources.map((source) => [String(source._id), source.name || "Unknown"]));
}

function reqUserObjectId(userId) {
  return mongoose.Types.ObjectId.isValid(String(userId || ""))
    ? new mongoose.Types.ObjectId(String(userId))
    : null;
}

function formatMonthLabel(value) {
  const [year, month] = String(value || "").split("-");
  const y = Number.parseInt(year, 10);
  const m = Number.parseInt(month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return String(value || "");
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function formatDateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPeriodSelection(plan) {
  if (!plan?.period) return null;
  return {
    period: normalizePeriod(plan.period),
    month: String(normalizeMonth(plan.month)),
    quarter: normalizeQuarter(plan.quarter),
    year: String(normalizeYear(plan.year)),
  };
}

function buildSummaryValue(metric, rows = []) {
  if (!rows.length) return 0;
  if (
    [
      "list_deals",
      "list_leads",
      "biggest_deals",
      "smallest_deals",
      "delayed_deals",
      "high_value_deals",
      "risk_deals",
      "stage_deals",
      "closing_this_month",
      "inactive_clients",
      "todays_followups",
      "overdue_followups",
      "pending_meetings",
      "completed_meetings",
      "user_list",
      "team_targets",
      "team_members",
      "team_list",
    ].includes(metric)
  ) {
    return rows.length;
  }
  if (metric === "win_rate" || metric === "conversion_rate") {
    return rows[0]?.value || 0;
  }
  return rows.reduce((sum, row) => sum + Number(row?.value || 0), 0);
}

async function runDealsReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);
  const baseMatch = { is_deleted: false };
  if (scopedIds.length) {
    baseMatch.assignedTo = {
      $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  const closedMetrics = new Set(["revenue", "won_deals", "lost_deals", "lost_revenue", "win_rate", "avg_deal_size", "average_sales_cycle"]);
  const sortByValue = String(plan.sort?.by || "").toLowerCase() === "value";
  const sortOrder = String(plan.sort?.order || "").toLowerCase() === "asc" ? 1 : -1;

  if (["revenue", "lost_revenue"].includes(plan.metric) && !plan.groupBy) {
    const detailMatch = { ...baseMatch };
    detailMatch.stage = plan.metric === "lost_revenue" ? DEAL_LOST_STAGE : DEAL_WON_STAGE;

    const pipeline = [
      { $match: detailMatch },
      { $addFields: { reportDate: { $ifNull: ["$actualCloseDate", "$updatedAt"] } } },
    ];
    if (range) {
      pipeline.push({ $match: { reportDate: { $gte: start, $lt: end } } });
    }
    pipeline.push(
      { $sort: { reportDate: -1, dealValue: -1, createdAt: -1 } },
      {
        $project: {
          deal_name: 1,
          stage: 1,
          dealValue: { $ifNull: ["$dealValue", 0] },
        },
      }
    );

    const rows = await Deal.aggregate(pipeline);

    return rows.map((deal) => ({
      label: `${deal?.deal_name || "Untitled Deal"}${deal?.stage ? ` (${deal.stage})` : ""}`,
      value: Number(deal?.dealValue || 0),
    }));
  }

    if (["list_deals", "biggest_deals", "smallest_deals", "stage_deals", "delayed_deals", "high_value_deals", "risk_deals", "closing_this_month"].includes(plan.metric)) {
      const findMatch = { ...baseMatch };

    if (plan.metric === "list_deals") {
      if (range) {
        findMatch.createdAt = { $gte: start, $lt: end };
      }
      } else if (plan.metric === "closing_this_month") {
        findMatch.expectedCloseDate = { $gte: start, $lt: end };
        findMatch.stage = OPEN_DEAL_STAGE_FILTER;
    } else if (plan.metric === "delayed_deals") {
      findMatch.expectedCloseDate = { $lt: new Date() };
      findMatch.stage = OPEN_DEAL_STAGE_FILTER;
    } else if (plan.metric === "stage_deals") {
      findMatch.stage = OPEN_DEAL_STAGE_FILTER;
    } else {
      findMatch.createdAt = { $gte: start, $lt: end };
    }

    if (plan.filters?.stage) findMatch.stage = plan.filters.stage;
    if (plan.metric === "high_value_deals") findMatch.dealValue = { $gte: 200000 };
    if (plan.metric === "risk_deals") {
      findMatch.aiRiskScore = { $gte: 60 };
      findMatch.stage = OPEN_DEAL_STAGE_FILTER;
    }

      const rows = await Deal.find(findMatch)
        .select("deal_name dealValue stage expectedCloseDate actualCloseDate aiRiskScore createdAt")
        .sort(plan.metric === "list_deals" ? { createdAt: -1 } : { dealValue: sortOrder, createdAt: -1 })
        .lean();

    return rows.map((deal) => ({
      label: `${deal?.deal_name || "Untitled Deal"}${deal?.stage ? ` (${deal.stage})` : ""}`,
      value:
        plan.metric === "list_deals"
          ? `${String(deal?.stage || "P1").toUpperCase()} / ₹${Number(deal?.dealValue || 0).toLocaleString("en-IN")}`
          : plan.metric === "risk_deals"
          ? Number(deal?.aiRiskScore || 0)
          : Number(deal?.dealValue || 0),
    }));
  }

  const pipeline = [{ $match: baseMatch }];

  if (plan.metric === "closing_this_month") {
    pipeline.push({ $match: { expectedCloseDate: { $gte: start, $lt: end }, stage: OPEN_DEAL_STAGE_FILTER } });
  } else if (plan.metric === "active_deals") {
    pipeline.push({ $match: { stage: OPEN_DEAL_STAGE_FILTER, isActive: true } });
    if (range) {
      pipeline.push({ $match: { createdAt: { $gte: start, $lt: end } } });
    }
    pipeline.push({ $addFields: { reportDate: "$createdAt" } });
  } else if (plan.metric === "inactive_deal_value") {
    pipeline.push({ $match: { isActive: false } });
    if (range) {
      pipeline.push({ $match: { createdAt: { $gte: start, $lt: end } } });
    }
    pipeline.push({ $addFields: { reportDate: "$createdAt" } });
  } else if (closedMetrics.has(plan.metric)) {
    pipeline.push({ $addFields: { reportDate: { $ifNull: ["$actualCloseDate", "$updatedAt"] } } });
    if (range) {
      pipeline.push({ $match: { reportDate: { $gte: start, $lt: end } } });
    }
  } else {
    if (range) {
      pipeline.push({ $match: { createdAt: { $gte: start, $lt: end } } });
    }
    pipeline.push({ $addFields: { reportDate: "$createdAt" } });
  }

  if (plan.filters?.stage) pipeline.push({ $match: { stage: plan.filters.stage } });

  let groupId = null;
  if (plan.groupBy === "salesperson") groupId = "$assignedTo";
  if (plan.groupBy === "stage") groupId = "$stage";
  if (plan.groupBy === "month") groupId = { $dateToString: { format: "%Y-%m", date: "$reportDate" } };
  if (plan.groupBy === "size") {
    groupId = {
      $switch: {
        branches: [
          { case: { $lt: ["$dealValue", 50000] }, then: "Small (<₹50K)" },
          { case: { $lt: ["$dealValue", 200000] }, then: "Medium (₹50K-₹2L)" },
        ],
        default: "Large (>₹2L)",
      },
    };
  }

  const groupStage = { _id: groupId };
  if (plan.metric === "revenue" || plan.metric === "lost_revenue" || plan.metric === "inactive_deal_value") {
    groupStage.value = { $sum: { $ifNull: ["$dealValue", 0] } };
  }
  if (["deal_count", "active_deals", "won_deals", "lost_deals"].includes(plan.metric)) {
    groupStage.value = { $sum: 1 };
  }
  if (plan.metric === "avg_deal_size") {
    groupStage.totalValue = { $sum: { $cond: [{ $eq: ["$stage", DEAL_WON_STAGE] }, { $ifNull: ["$dealValue", 0] }, 0] } };
    groupStage.wonCount = { $sum: { $cond: [{ $eq: ["$stage", DEAL_WON_STAGE] }, 1, 0] } };
  }
  if (plan.metric === "win_rate") {
    groupStage.wonCount = { $sum: { $cond: [{ $eq: ["$stage", DEAL_WON_STAGE] }, 1, 0] } };
    groupStage.closedCount = { $sum: { $cond: [{ $in: ["$stage", [DEAL_WON_STAGE, DEAL_LOST_STAGE]] }, 1, 0] } };
  }
  if (plan.metric === "average_sales_cycle") {
    groupStage.totalDays = {
      $sum: {
        $divide: [{ $subtract: ["$reportDate", "$createdAt"] }, 1000 * 60 * 60 * 24],
      },
    };
    groupStage.dealCount = { $sum: 1 };
  }

  if (plan.metric === "lost_revenue") pipeline.push({ $match: { stage: DEAL_LOST_STAGE } });

  pipeline.push({ $group: groupStage });

  if (plan.metric === "avg_deal_size") {
    pipeline.push({ $project: { _id: 1, value: { $cond: [{ $gt: ["$wonCount", 0] }, { $divide: ["$totalValue", "$wonCount"] }, 0] } } });
  }
  if (plan.metric === "win_rate") {
    pipeline.push({ $project: { _id: 1, value: { $cond: [{ $gt: ["$closedCount", 0] }, { $multiply: [{ $divide: ["$wonCount", "$closedCount"] }, 100] }, 0] } } });
  }
  if (plan.metric === "average_sales_cycle") {
    pipeline.push({ $project: { _id: 1, value: { $cond: [{ $gt: ["$dealCount", 0] }, { $divide: ["$totalDays", "$dealCount"] }, 0] } } });
  }

  pipeline.push({ $sort: sortByValue ? { value: sortOrder } : { _id: 1 } });
  pipeline.push({ $limit: plan.limit });

  const rows = await Deal.aggregate(pipeline);
  const userLabelMap = await mapUserLabels(rows.map((row) => String(row?._id || "")));

  return rows.map((row) => {
    let label = "All";
    if (plan.groupBy === "salesperson") label = userLabelMap.get(String(row?._id || "")) || "Unassigned";
    else if (plan.groupBy === "month") label = formatMonthLabel(row?._id);
    else if (row?._id !== null && row?._id !== undefined && row?._id !== "") label = String(row._id);
    return { label, value: Number(row?.value || 0) };
  });
}

async function runLeadsReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);
  const match = {};

  if (range) {
    match.created_at = { $gte: start, $lt: end };
  }

  if (plan.metric === "deleted_leads") {
    match.is_deleted = true;
  } else {
    match.is_deleted = { $ne: true };
  }

  if (plan.filters?.assigned_to_me) {
    match.assigned_to = reqUserObjectId(user?._id);
  } else if (scopedIds.length) {
    match.assigned_to = {
      $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  if (plan.filters?.status) match.status = plan.filters.status;
  if (plan.metric === "non_converted_count") {
    match.converted_to_deal = false;
  }
  if (plan.metric === "inactive_leads") {
    match.is_active = false;
    match.is_deleted = { $ne: true };
    match.converted_to_deal = { $ne: true };
  }
  if (Array.isArray(plan.filters?.sourceIds) && plan.filters.sourceIds.length) {
    match.source = {
      $in: plan.filters.sourceIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  if (plan.metric === "list_leads") {
    const leadDocs = await Leads.find(match)
      .select("company_name stage created_at assigned_to source")
      .sort({ created_at: -1, updated_at: -1 })
      .limit(plan.limit)
      .lean();

    const userLabelMap = await mapUserLabels(leadDocs.map((lead) => String(lead?.assigned_to || "")));
    const sourceLabelMap = await mapSourceLabels(leadDocs.map((lead) => String(lead?.source || "")));

    return leadDocs.map((lead) => {
      const createdAt = lead?.created_at
        ? new Date(lead.created_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "--";
      const stageLabel = String(lead?.stage || "").trim() || "--";
      const sourceLabel = sourceLabelMap.get(String(lead?.source || "")) || "Unknown source";
      const assigneeLabel = userLabelMap.get(String(lead?.assigned_to || "")) || "Unassigned";

      return {
        label: String(lead?.company_name || "").trim() || "Unnamed Lead",
        value: `${stageLabel} | ${sourceLabel} | ${assigneeLabel} | ${createdAt}`,
      };
    });
  }

  if (plan.metric === "uncontacted_count") {
    const leadDocs = await Leads.find(match)
      .select("_id last_contact_date source assigned_to status created_at")
      .lean();

    const leadIds = leadDocs
      .map((lead) => lead?._id)
      .filter(Boolean);

    const followupAgg = leadIds.length
      ? await Followup.aggregate([
          {
            $match: {
              is_deleted: false,
              leadId: { $in: leadIds },
            },
          },
          {
            $group: {
              _id: "$leadId",
              totalFollowups: { $sum: 1 },
            },
          },
        ])
      : [];

    const followupMap = new Map(
      followupAgg
        .filter((row) => row?._id)
        .map((row) => [String(row._id), Number(row.totalFollowups || 0)])
    );

    const counts = new Map();
    for (const lead of leadDocs) {
      const leadId = String(lead?._id || "");
      const hasFollowups = Number(followupMap.get(leadId) || 0) > 0;
      const hasLastContact = Boolean(lead?.last_contact_date);
      const hasActivity = hasFollowups || hasLastContact;
      if (hasActivity) continue;

      let groupKey = "__all__";
      if (plan.groupBy === "source") groupKey = String(lead?.source || "");
      else if (plan.groupBy === "salesperson") groupKey = String(lead?.assigned_to || "");
      else if (plan.groupBy === "status") groupKey = String(lead?.status || "");
      else if (plan.groupBy === "month") {
        const createdAt = lead?.created_at ? new Date(lead.created_at) : null;
        groupKey =
          createdAt && !Number.isNaN(createdAt.getTime())
            ? `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`
            : "";
      }

      counts.set(groupKey, Number(counts.get(groupKey) || 0) + 1);
    }

    let rows = Array.from(counts.entries()).map(([key, value]) => ({
      _id: key === "__all__" ? null : key,
      value,
    }));

    const sortByValue = String(plan.sort?.by || "").toLowerCase() === "value";
    const sortOrder = String(plan.sort?.order || "").toLowerCase() === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortByValue) return (Number(a.value || 0) - Number(b.value || 0)) * sortOrder;
      return String(a._id || "").localeCompare(String(b._id || ""));
    });
    rows = rows.slice(0, plan.limit);

    const userLabelMap = await mapUserLabels(rows.map((row) => String(row?._id || "")));
    const sourceLabelMap = await mapSourceLabels(rows.map((row) => String(row?._id || "")));

    return rows.map((row) => {
      let label = "All";
      if (plan.groupBy === "salesperson") label = userLabelMap.get(String(row?._id || "")) || "Unassigned";
      else if (plan.groupBy === "source") label = sourceLabelMap.get(String(row?._id || "")) || "Unknown";
      else if (plan.groupBy === "month") label = formatMonthLabel(row?._id);
      else if (row?._id !== null && row?._id !== undefined && row?._id !== "") label = String(row._id);
      return { label, value: Number(row?.value || 0) };
    });
  }

  const pipeline = [{ $match: match }];
  let groupId = null;
  if (plan.groupBy === "source") groupId = "$source";
  if (plan.groupBy === "salesperson") groupId = "$assigned_to";
  if (plan.groupBy === "status") groupId = "$status";
  if (plan.groupBy === "month") groupId = { $dateToString: { format: "%Y-%m", date: "$created_at" } };

  const groupStage = { _id: groupId };
  if (plan.metric === "lead_count") groupStage.value = { $sum: 1 };
  if (plan.metric === "converted_count") groupStage.value = { $sum: { $cond: [{ $eq: ["$converted_to_deal", true] }, 1, 0] } };
  if (plan.metric === "non_converted_count") groupStage.value = { $sum: { $cond: [{ $eq: ["$converted_to_deal", false] }, 1, 0] } };
  if (plan.metric === "qualified_count") groupStage.value = { $sum: { $cond: [{ $eq: ["$status", "qualified"] }, 1, 0] } };
  if (plan.metric === "conversion_rate") {
    groupStage.totalCount = { $sum: 1 };
    groupStage.convertedCount = { $sum: { $cond: [{ $eq: ["$converted_to_deal", true] }, 1, 0] } };
  }

  pipeline.push({ $group: groupStage });

  if (plan.metric === "conversion_rate") {
    pipeline.push({
      $project: {
        _id: 1,
        value: {
          $cond: [{ $gt: ["$totalCount", 0] }, { $multiply: [{ $divide: ["$convertedCount", "$totalCount"] }, 100] }, 0],
        },
      },
    });
  }

  const sortByValue = String(plan.sort?.by || "").toLowerCase() === "value";
  const sortOrder = String(plan.sort?.order || "").toLowerCase() === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortByValue ? { value: sortOrder } : { _id: 1 } });
  pipeline.push({ $limit: plan.limit });

  const rows = await Leads.aggregate(pipeline);
  const userLabelMap = await mapUserLabels(rows.map((row) => String(row?._id || "")));
  const sourceLabelMap = await mapSourceLabels(rows.map((row) => String(row?._id || "")));

  return rows.map((row) => {
    let label = "All";
    if (plan.groupBy === "salesperson") label = userLabelMap.get(String(row?._id || "")) || "Unassigned";
    else if (plan.groupBy === "source") label = sourceLabelMap.get(String(row?._id || "")) || "Unknown";
    else if (plan.groupBy === "month") label = formatMonthLabel(row?._id);
    else if (row?._id !== null && row?._id !== undefined && row?._id !== "") label = String(row._id);
    return { label, value: Number(row?.value || 0) };
  });
}

async function runExpensesReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);
  const match = { is_deleted: false };

  if (range) {
    match.expenseDate = { $gte: start, $lt: end };
  }

  if (scopedIds.length) {
    match.userId = {
      $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  if (plan.filters?.approval_status) match["approval.status"] = plan.filters.approval_status;
  if (plan.filters?.category) match.category = plan.filters.category;
  if (plan.filters?.reference_type) match.referenceType = plan.filters.reference_type;

  if (["expense_total", "approved_total"].includes(plan.metric) && !plan.groupBy) {
    const detailMatch = { ...match };
    if (plan.metric === "approved_total") {
      detailMatch["approval.status"] = "approved";
    }

    const rows = await Expense.find(detailMatch)
      .select("expenseNo vendorName category totalAmount approval expenseDate referenceType")
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean();

    return rows.map((expense) => {
      const expenseDate = expense?.expenseDate
        ? new Date(expense.expenseDate).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "--";
      const vendorLabel =
        String(expense?.vendorName || "").trim() ||
        String(expense?.category || "expense").replace(/_/g, " ");

      return {
        label: `#${expense?.expenseNo || "--"} · ${vendorLabel} · ${expenseDate}`,
        value: Number(expense?.totalAmount || 0),
      };
    });
  }

  const pipeline = [{ $match: match }];
  let groupId = null;
  if (plan.groupBy === "category") groupId = "$category";
  if (plan.groupBy === "approval_status") groupId = "$approval.status";
  if (plan.groupBy === "reference_type") groupId = "$referenceType";
  if (plan.groupBy === "user") groupId = "$userId";
  if (plan.groupBy === "month") groupId = { $dateToString: { format: "%Y-%m", date: "$expenseDate" } };

  const groupStage = { _id: groupId };
  if (plan.metric === "expense_total") groupStage.value = { $sum: { $ifNull: ["$totalAmount", 0] } };
  if (plan.metric === "expense_count") groupStage.value = { $sum: 1 };
  if (plan.metric === "approved_total") groupStage.value = { $sum: { $cond: [{ $eq: ["$approval.status", "approved"] }, { $ifNull: ["$totalAmount", 0] }, 0] } };
  if (plan.metric === "pending_count") groupStage.value = { $sum: { $cond: [{ $eq: ["$approval.status", "pending"] }, 1, 0] } };
  if (plan.metric === "rejected_count") groupStage.value = { $sum: { $cond: [{ $eq: ["$approval.status", "rejected"] }, 1, 0] } };

  pipeline.push({ $group: groupStage });

  const sortByValue = String(plan.sort?.by || "").toLowerCase() === "value";
  const sortOrder = String(plan.sort?.order || "").toLowerCase() === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortByValue ? { value: sortOrder } : { _id: 1 } });
  pipeline.push({ $limit: plan.limit });

  const rows = await Expense.aggregate(pipeline);
  const userLabelMap = await mapUserLabels(rows.map((row) => String(row?._id || "")));

  return rows.map((row) => {
    let label = "All";
    if (plan.groupBy === "user") label = userLabelMap.get(String(row?._id || "")) || "User";
    else if (plan.groupBy === "month") label = formatMonthLabel(row?._id);
    else if (row?._id !== null && row?._id !== undefined && row?._id !== "") label = String(row._id);
    return { label, value: Number(row?.value || 0) };
  });
}

async function runClientsReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);

  if (plan.metric === "top_clients_revenue") {
    const match = {
      is_deleted: false,
      stage: DEAL_WON_STAGE,
      client_id: { $ne: null },
    };
    if (scopedIds.length) {
      match.assignedTo = {
        $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const pipeline = [
      { $match: match },
      { $addFields: { reportDate: { $ifNull: ["$actualCloseDate", "$updatedAt"] } } },
    ];
    if (range) {
      pipeline.push({ $match: { reportDate: { $gte: start, $lt: end } } });
    }
    pipeline.push(
      { $group: { _id: "$client_id", value: { $sum: { $ifNull: ["$dealValue", 0] } } } },
      { $sort: { value: -1 } },
      { $limit: plan.limit }
    );

    const rows = await Deal.aggregate(pipeline);

    const clientIds = rows
      .map((row) => String(row?._id || ""))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const clients = await Client.find({ _id: { $in: clientIds } })
      .select("name")
      .lean();
    const clientMap = new Map(clients.map((client) => [String(client._id), client.name || "Client"]));

    return rows.map((row) => ({
      label: clientMap.get(String(row?._id || "")) || "Client",
      value: Number(row?.value || 0),
    }));
  }

  const inactiveClientDealScope = {
    is_deleted: false,
    stage: OPEN_DEAL_STAGE_FILTER,
    client_id: { $ne: null },
  };
  if (scopedIds.length) {
    inactiveClientDealScope.assignedTo = {
      $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  if (range) {
    inactiveClientDealScope.createdAt = { $gte: start, $lt: end };
  }

  const activeClientIds = await Deal.distinct("client_id", inactiveClientDealScope);
  const clientMatch = {
    is_deleted: false,
    _id: { $nin: activeClientIds },
  };
  if (range) {
    clientMatch.createdAt = { $gte: start, $lt: end };
  }

  const rows = await Client.find(clientMatch)
    .select("name deal_count")
    .sort({ deal_count: 1, name: 1 })
    .limit(plan.limit)
    .lean();

  return rows.map((client) => ({
    label: client?.name || "Client",
    value: Number(client?.deal_count || 0),
  }));
}

async function runUsersReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);
  const match = {};
  if (plan.metric === "deleted_users") {
    match.is_deleted = true;
  } else {
    match.is_deleted = { $ne: true };
  }

  if (plan.metric === "active_users") {
    match.is_active = true;
  }

  if (plan.metric === "inactive_users") {
    match.is_active = false;
  }

  if (scopedIds.length) {
    match._id = {
      $in: scopedIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  if (range) {
    match.createdAt = { $gte: start, $lt: end };
  }

  const users = await User.find(match)
    .select("name email role is_active is_deleted")
    .lean();

  const roleIds = [...new Set(
    users
      .map((entry) => String(entry?.role || "").trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )].map((id) => new mongoose.Types.ObjectId(id));

  const roles = roleIds.length
    ? await Role.find({ _id: { $in: roleIds } })
        .select("name")
        .lean()
    : [];
  const roleMap = new Map(
    (roles || []).map((role) => [String(role?._id || ""), role?.name || "Role"])
  );

  const teams = await Team.find({})
    .select("name members teamLeads")
    .lean();
  const userTeamMap = new Map();
  for (const team of teams) {
    const teamName = team?.name || "Untitled Team";
    const memberIds = [
      ...(team?.members || []).map((member) => String(member?.userId || "")),
      ...(team?.teamLeads || []).map((lead) => String(lead?.userId || "")),
    ].filter(Boolean);
    for (const userId of memberIds) {
      if (!userTeamMap.has(userId)) {
        userTeamMap.set(userId, teamName);
      }
    }
  }

  if (plan.metric === "user_list") {
    return users.map((entry) => ({
        label: entry?.name || entry?.email || "User",
        value: `${roleMap.get(String(entry?.role || "")) || "Role"} / ${userTeamMap.get(String(entry?._id || "")) || "No team"}`,
      }));
  }

  if (plan.groupBy === "role" || plan.groupBy === "team") {
    const counts = new Map();
    for (const entry of users) {
      const groupLabel =
        plan.groupBy === "role"
          ? roleMap.get(String(entry?.role || "")) || "Unknown Role"
          : userTeamMap.get(String(entry?._id || "")) || "No team";
      counts.set(groupLabel, Number(counts.get(groupLabel) || 0) + 1);
    }

    let rows = Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
    const sortByValue = String(plan.sort?.by || "").toLowerCase() === "value";
    const sortOrder = String(plan.sort?.order || "").toLowerCase() === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortByValue) return (Number(a.value || 0) - Number(b.value || 0)) * sortOrder;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
    return rows.slice(0, plan.limit);
  }

  return [{ label: "All", value: users.length }];
}

async function runFollowupsReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;
  const scopedIds = await getScopedUserIds(user);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const returnAllRows =
    !plan?.groupBy &&
    !selection &&
    ["todays_followups", "overdue_followups", "pending_meetings", "completed_meetings"].includes(plan.metric);

  const match = { is_deleted: false };
  if (scopedIds.length) {
    match.assignedTo = {
      $in: scopedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  if (plan.metric === "todays_followups") {
    match.kind = "followup";
    match.dueDateTime = { $gte: startOfToday, $lt: endOfToday };
    match.status = { $in: ["pending", "overdue", "completed"] };
  } else if (plan.metric === "overdue_followups") {
    match.kind = "followup";
    if (range) {
      match.dueDateTime = { $gte: start, $lt: minDate(end, now) };
    } else {
      match.dueDateTime = { $lt: now };
    }
    match.status = { $in: ["pending", "overdue"] };
  } else if (plan.metric === "pending_meetings") {
    match.kind = "meeting";
    match.status = { $in: ["pending", "overdue"] };
    if (range) {
      match.dueDateTime = { $gte: start, $lt: end };
    }
  } else if (plan.metric === "completed_meetings") {
    match.kind = "meeting";
    match.status = "completed";
    if (range) {
      match.completedAt = { $gte: start, $lt: end };
    }
  } else if (range) {
    match.dueDateTime = { $gte: start, $lt: end };
  }

  if (plan.groupBy === "employee") {
    const rows = await Followup.aggregate([
      { $match: match },
      { $group: { _id: "$assignedTo", value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: plan.limit },
    ]);
    const userMap = await mapUserLabels(rows.map((row) => String(row?._id || "")));
    return rows.map((row) => ({
      label: userMap.get(String(row?._id || "")) || "User",
      value: Number(row?.value || 0),
    }));
  }

  const rows = await Followup.find(match)
    .select("title clientName dueDateTime status assignedTo")
    .sort({ dueDateTime: 1, createdAt: -1 })
    .lean();

  const limitedRows = returnAllRows ? rows : rows.slice(0, plan.limit);

  return limitedRows.map((followup) => ({
    label: followup?.title || followup?.clientName || "Follow-up",
    value: formatDateTimeLabel(followup?.dueDateTime || now),
  }));
}

async function runTeamsReport(plan, user) {
  const selection = buildPeriodSelection(plan);
  const range = selection ? getSelectionRange(selection) : null;
  const start = range?.start;
  const end = range?.end;

  const teamFilter = isAdmin(user?.role)
    ? {}
    : {
        $or: [
          { "teamLeads.userId": user?._id },
          { "members.userId": user?._id },
        ],
      };
  if (range) {
    teamFilter.createdAt = { $gte: start, $lt: end };
  }
  const teams = await Team.find(teamFilter)
    .select("name members teamLeads")
    .lean();

  if (!teams.length) return [];

  if (plan.metric === "team_count") {
    return [{ label: "All", value: teams.length }];
  }

  if (plan.metric === "team_members") {
    return teams.map((team) => {
      const uniqueMembers = new Set([
        ...(team?.members || []).map((member) => String(member?.userId || "")),
        ...(team?.teamLeads || []).map((lead) => String(lead?.userId || "")),
      ].filter(Boolean));

      return {
        label: team?.name || "Untitled Team",
        value: uniqueMembers.size,
      };
    });
  }

  if (plan.metric === "team_list") {
    return teams.map((team) => {
      const uniqueMembers = new Set([
        ...(team?.members || []).map((member) => String(member?.userId || "")),
        ...(team?.teamLeads || []).map((lead) => String(lead?.userId || "")),
      ].filter(Boolean));

      return {
        label: team?.name || "Untitled Team",
        value: `${uniqueMembers.size} members`,
      };
    });
  }

  const teamIds = teams.map((team) => team._id);
  const targetMatch = {
    scope_type: "team",
    team_id: { $in: teamIds },
    status: { $ne: "archived" },
  };
  if (range && selection) {
    targetMatch.period_start = start;
    targetMatch.period_end = end;
    targetMatch.period_type = selection.period === "yearly" ? "quarterly" : selection.period;
  }

  const targetDocs = await SalesTarget.find(targetMatch)
    .sort(range ? { updated_at: -1, created_at: -1 } : { period_end: -1, updated_at: -1, created_at: -1 })
    .lean();

  const targetMap = new Map();
  for (const doc of targetDocs) {
    const key = String(doc?.team_id || "");
    if (!key || targetMap.has(key)) continue;
    targetMap.set(key, doc);
  }

  return teams.map((team) => {
    const target = targetMap.get(String(team._id || "")) || null;
    return {
      label: team?.name || "Untitled Team",
      value: target
        ? `Revenue ₹${Number(target.revenue_target || 0).toLocaleString("en-IN")} / Deals ${Number(target.deal_target || 0)}`
        : "No target assigned",
    };
  });
}

  function metricLabel(metric) {
    const map = {
      revenue: "Revenue",
      deal_count: "Deal Count",
    won_deals: "Won Deals",
    lost_deals: "Lost Deals",
    lost_revenue: "Lost Revenue",
    win_rate: "Win Rate",
    avg_deal_size: "Average Deal Size",
    average_sales_cycle: "Average Sales Cycle",
    active_deals: "Active Deals",
    biggest_deals: "Biggest Deals",
    smallest_deals: "Smallest Deals",
    delayed_deals: "Delayed Deals",
    high_value_deals: "High Value Deals",
    risk_deals: "Risk Deals",
    stage_deals: "Stage Deals",
    closing_this_month: "Deals Closing This Month",
    inactive_deal_value: "Inactive Deal Value",
    list_deals: "Deals List",
    lead_count: "Lead Count",
    list_leads: "Leads List",
    converted_count: "Converted Leads",
    non_converted_count: "Non-Converted Leads",
    uncontacted_count: "Uncontacted Leads",
    conversion_rate: "Lead Conversion Rate",
    qualified_count: "Qualified Leads",
    deleted_leads: "Deleted Leads",
    inactive_leads: "Inactive Leads",
    expense_total: "Expense Total",
    expense_count: "Expense Count",
    approved_total: "Approved Expense Total",
    pending_count: "Pending Expenses",
    rejected_count: "Rejected Expenses",
    top_clients_revenue: "Top Clients By Revenue",
    inactive_clients: "Inactive Clients",
    todays_followups: "Today's Follow-Ups",
      overdue_followups: "Overdue Follow-Ups",
      pending_meetings: "Pending Meetings",
      completed_meetings: "Completed Meetings",
      followup_count: "Follow-Ups",
      user_count: "User Count",
      active_users: "Active Users",
      inactive_users: "Inactive Users",
      deleted_users: "Deleted Users",
      user_list: "Users",
      team_targets: "Team Targets",
      team_count: "Team Count",
      team_members: "Team Members",
      team_list: "Teams",
    };
    return map[metric] || metric;
  }

function buildColumns(plan) {
  if (["todays_followups", "overdue_followups", "pending_meetings", "completed_meetings"].includes(plan.metric)) {
    return [
      { key: "label", label: "Title" },
      { key: "value", label: "Due At" },
    ];
  }

  if (["biggest_deals", "smallest_deals", "high_value_deals", "stage_deals", "closing_this_month"].includes(plan.metric)) {
    return [
      { key: "label", label: "Deal" },
      { key: "value", label: "Deal Value" },
    ];
  }

  if (["revenue", "lost_revenue"].includes(plan.metric) && !plan.groupBy) {
    return [
      { key: "label", label: "Deal" },
      { key: "value", label: metricLabel(plan.metric) },
    ];
  }

  if (["expense_total", "approved_total"].includes(plan.metric) && !plan.groupBy) {
    return [
      { key: "label", label: "Expense" },
      { key: "value", label: metricLabel(plan.metric) },
    ];
  }

  if (plan.metric === "list_deals") {
    return [
      { key: "label", label: "Deal" },
      { key: "value", label: "Stage / Value" },
    ];
  }

  if (plan.metric === "list_leads") {
    return [
      { key: "label", label: "Lead" },
      { key: "value", label: "Stage / Source / Assigned / Created" },
    ];
  }

  if (plan.metric === "risk_deals") {
    return [
      { key: "label", label: "Deal" },
      { key: "value", label: "Risk Score" },
    ];
  }

  if (plan.metric === "inactive_clients") {
    return [
      { key: "label", label: "Client" },
      { key: "value", label: "Deal Count" },
    ];
  }

  if (plan.metric === "team_targets") {
    return [
      { key: "label", label: "Team" },
      { key: "value", label: "Targets" },
    ];
  }

  if (plan.metric === "team_members") {
    return [
      { key: "label", label: "Team" },
      { key: "value", label: "Members" },
    ];
  }

  if (plan.metric === "team_list") {
    return [
      { key: "label", label: "Team" },
      { key: "value", label: "Summary" },
    ];
  }

  if (plan.metric === "user_list") {
    return [
      { key: "label", label: "User" },
      { key: "value", label: "Role / Team" },
    ];
  }

  return [
    { key: "label", label: plan.groupBy ? "Group" : "Result" },
    { key: "value", label: metricLabel(plan.metric) },
  ];
}

exports.aiQuery = async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) {
      return res.status(400).json({ message: "Question is required" });
    }

    const deterministicPlan = await buildDeterministicPlan(question);
    if (deterministicPlan?.hardUnsupported) {
      return res.status(400).json({
        message: deterministicPlan.reason,
      });
    }

      const geminiConfigured = Boolean(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.OPENAI_API_KEY
      );

      let rawPlan = deterministicPlan;
      let provider = "deterministic";
      let parserWarning = "";

      if (geminiConfigured) {
        const geminiPlan = await askGeminiForPlan(question).catch((error) => {
          console.error("askGeminiForPlan error:", error?.response?.data || error);
          return null;
        });

        if (geminiPlan && !geminiPlan.unsupported) {
          const shouldPreferDeterministicListPlan =
            hasExplicitListIntent(question) &&
            ["list_leads", "list_deals", "user_list", "team_list"].includes(deterministicPlan?.metric) &&
            !["list_leads", "list_deals", "user_list", "team_list"].includes(geminiPlan?.metric);

          if (shouldPreferDeterministicListPlan) {
            rawPlan = deterministicPlan;
            provider = "deterministic";
            parserWarning = "Used deterministic parsing to preserve explicit list intent.";
          } else {
            rawPlan = geminiPlan;
            provider = "gemini";
          }
        } else if (deterministicPlan?.unsupported) {
          if (geminiPlan?.unsupported) {
            console.log("[Custom Report] Gemini unsupported:", geminiPlan.reason || "");
          }

          if (hasSupportedIntent(question)) {
            rawPlan = buildHeuristicPlan(question);
            provider = "heuristic";
            parserWarning = geminiPlan?.reason
              ? `Gemini could not classify this question (${geminiPlan.reason}). Used fallback intent parsing instead.`
              : "Gemini could not classify this question. Used fallback intent parsing instead.";
          } else {
            return res.status(400).json({
              message: geminiPlan?.reason || deterministicPlan.reason || "Unsupported or ambiguous question.",
            });
          }
        } else if (geminiPlan?.unsupported) {
          console.log("[Custom Report] Gemini unsupported:", geminiPlan.reason || "");
          parserWarning = geminiPlan.reason
            ? `Gemini could not classify this question (${geminiPlan.reason}). Used deterministic parsing instead.`
            : "Gemini could not classify this question. Used deterministic parsing instead.";
        }
      } else if (deterministicPlan?.unsupported) {
        if (hasSupportedIntent(question)) {
          rawPlan = buildHeuristicPlan(question);
          provider = "heuristic";
          parserWarning = "Used fallback intent parsing because the AI planner is not configured.";
        } else {
          return res.status(400).json({
            message: deterministicPlan.reason || "Unsupported or ambiguous question.",
          });
        }
      }
      const reportUser = await resolveReportUserContext(req.user);
      const plan = normalizePlan(rawPlan, question);
      console.log("[Custom Report] User:", {
        id: String(reportUser?._id || ""),
        email: reportUser?.email || "",
        role: reportUser?.role || "",
      });
      console.log("[Custom Report] Question:", question);
      console.log("[Custom Report] Interpreted Query:", JSON.stringify(plan, null, 2));
      if (parserWarning) {
        console.warn("[Custom Report] Parser notice:", parserWarning);
      }

      let rows = [];
      if (plan.module === "deals") rows = await runDealsReport(plan, reportUser);
      if (plan.module === "leads") rows = await runLeadsReport(plan, reportUser);
      if (plan.module === "expenses") rows = await runExpensesReport(plan, reportUser);
      if (plan.module === "clients") rows = await runClientsReport(plan, reportUser);
      if (plan.module === "followups") rows = await runFollowupsReport(plan, reportUser);
      if (plan.module === "users") rows = await runUsersReport(plan, reportUser);
      if (plan.module === "teams") rows = await runTeamsReport(plan, reportUser);

      const summaryValue = buildSummaryValue(plan.metric, rows);

      res.json({
        question,
        title: `${metricLabel(plan.metric)} Report`,
        chartType: plan.chartType,
        module: plan.module,
        metric: plan.metric,
      groupBy: plan.groupBy,
      selection: buildPeriodSelection(plan),
      interpretedQuery: plan,
      provider,
        summary: {
          label: metricLabel(plan.metric),
          value: typeof summaryValue === "number" ? Number(summaryValue.toFixed(2)) : summaryValue,
          rowCount: rows.length,
        },
      columns: buildColumns(plan),
      data: rows.length ? rows : [{ label: "No data", value: 0 }],
    });
  } catch (error) {
    console.error("aiQuery error:", error?.response?.data || error);
    res.status(500).json({
      message: "Failed to generate custom report",
      detail: error?.response?.data?.error?.message || error.message,
    });
  }
};
