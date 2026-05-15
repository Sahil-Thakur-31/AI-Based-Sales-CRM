const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

class AIInsightError extends Error {
  constructor(message, status = 500, code = "AI_INSIGHTS_FAILED", cause = null) {
    super(message);
    this.name = "AIInsightError";
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatCurrency(value) {
  return toNumber(value).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRole(role = "") {
  return String(role || "user").trim().toLowerCase();
}

function normalizeScope(scope = "", role = "user") {
  const roleName = normalizeRole(role);
  const requested = String(scope || "").trim().toLowerCase();

  if (roleName === "admin") return requested === "team" ? "team" : "company";
  if (roleName === "manager") return requested === "team" ? "team" : "personal";
  return "personal";
}

function titleCase(value = "") {
  return String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getScopeLabel(scope) {
  if (scope === "company") return "Company";
  if (scope === "team") return "Team";
  return "Personal";
}

function daysBetween(now, input) {
  const date = safeDate(input);
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function pickTop(items = [], limit = 5, sorter) {
  return items.slice().sort(sorter).slice(0, limit);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getActionPath(target = "") {
  const map = {
    deals: "/deals",
    leads: "/leads",
    followups: "/followups",
    quotations: "/quotations",
    meetings: "/calendar",
    expenses: "/expenses",
    clients: "/clients",
    team_dashboard: "/team-dashboard",
    ai_insights: "/ai-insights",
    calendar: "/calendar",
  };

  return map[String(target || "").trim().toLowerCase()] || "/ai-insights";
}

function createId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

function sanitizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function buildMetricCards(metrics) {
  return [
    {
      label: "Open Pipeline",
      value: formatCurrency(metrics.totalPipeline),
      note: `${metrics.openDealsCount} open deals`,
    },
    {
      label: "Weighted Forecast",
      value: formatCurrency(metrics.weightedPipeline),
      note: "Pipeline weighted by deal probability",
    },
    {
      label: "Open Quotations",
      value: formatCurrency(metrics.activeQuoteValue),
      note: `${metrics.activeQuotesCount} live quotations`,
    },
    {
      label: "Action Load",
      value: String(metrics.overdueFollowupsCount + metrics.dueTodayFollowupsCount),
      note: `${metrics.overdueFollowupsCount} overdue, ${metrics.dueTodayFollowupsCount} due today`,
    },
  ];
}

function hasMeaningfulCrmData(metrics = {}) {
  return [
    metrics.dealsCount,
    metrics.leadsCount,
    metrics.followupsCount,
    metrics.meetingsCount,
    metrics.activeQuotesCount,
    metrics.clientsCount,
  ].some((value) => toNumber(value) > 0);
}

function buildEmptyInsightResponse(evidencePack, modelName = "") {
  return {
    meta: {
      analysisMode: "empty",
      fallbackReasonCode: "",
      fallbackReasonMessage: "",
    },
    summary: {
      role: titleCase(evidencePack.metadata.role),
      scope: evidencePack.metadata.scope,
      scopeLabel: evidencePack.metadata.scopeLabel,
      analysisDate: evidencePack.metadata.analysisDate,
      healthScore: 0,
      healthLabel: "Waiting for CRM activity",
      confidence: "No meaningful CRM activity was found in this scope yet.",
      metrics: evidencePack.metrics,
    },
    narrative: {
      headline: `${evidencePack.metadata.scopeLabel} AI insights are waiting for more activity`,
      summary:
        "There is not enough live CRM evidence in this view yet for the LLM to generate a meaningful insight report. Add or update leads, deals, follow-ups, meetings, quotations, or clients in this scope and try again.",
      confidence: "The page is available, but the selected scope does not yet contain enough CRM activity for analysis.",
      model: modelName || "not-invoked",
    },
    overviewCards: evidencePack.fallbackOverviewCards,
    priorities: [],
    opportunities: [],
    recommendations: [],
    coachQuestions: [],
    drivers: [],
    outlook: [
      {
        label: "Status",
        value: "Insufficient data",
        note: "The AI model was not called because this scope is effectively empty.",
      },
    ],
    teamBoard: [],
    evidencePack,
  };
}

function inferSeverity(count, highThreshold = 5, mediumThreshold = 1) {
  const value = toNumber(count);
  if (value >= highThreshold) return "high";
  if (value >= mediumThreshold) return "medium";
  return "low";
}

function buildOfflineFallbackResponse(evidencePack, modelName = "offline-fallback") {
  const metrics = evidencePack.metrics || {};
  const scopeLabel = evidencePack.metadata?.scopeLabel || "CRM";
  const priorities = [];
  const opportunities = [];
  const recommendations = [];
  const drivers = [];
  const coachQuestions = [];
  const outlook = [];

  if (toNumber(metrics.overdueFollowupsCount) > 0) {
    priorities.push({
      id: "fallback-priority-followups",
      title: "Overdue follow-ups are slowing execution",
      message: `${metrics.overdueFollowupsCount} follow-ups are overdue in this ${scopeLabel.toLowerCase()} view, which creates avoidable response delays and deal slippage risk.`,
      impact: "Recover stalled momentum",
      severity: inferSeverity(metrics.overdueFollowupsCount, 6, 2),
      category: "Execution Risk",
      actionLabel: "Open Follow-ups",
      actionTarget: "followups",
      actionPath: getActionPath("followups"),
      evidence: [
        `${metrics.overdueFollowupsCount} overdue follow-ups`,
        `${metrics.dueTodayFollowupsCount} more actions due today`,
      ],
    });
  }

  if (toNumber(metrics.staleLeadsCount) > 0) {
    priorities.push({
      id: "fallback-priority-leads",
      title: "Aging leads need requalification",
      message: `${metrics.staleLeadsCount} leads have weak recent-contact signals. The pipeline quality in this scope will improve if these leads are reworked, reassigned, or closed.`,
      impact: "Improve funnel quality",
      severity: inferSeverity(metrics.staleLeadsCount, 8, 3),
      category: "Lead Hygiene",
      actionLabel: "Open Leads",
      actionTarget: "leads",
      actionPath: getActionPath("leads"),
      evidence: [
        `${metrics.staleLeadsCount} stale leads`,
        `${metrics.hotLeadsCount} hot leads still active`,
      ],
    });
  }

  if (toNumber(metrics.activeQuoteValue) > 0) {
    opportunities.push({
      id: "fallback-opportunity-quotes",
      title: "Open quotations represent near-term revenue",
      message: `${formatCurrency(metrics.activeQuoteValue)} is sitting in ${metrics.activeQuotesCount} active quotations. This is usually the clearest buying-intent pocket already inside the CRM.`,
      impact: "Accelerate revenue conversion",
      severity: inferSeverity(metrics.activeQuotesCount, 6, 2),
      category: "Revenue Opportunity",
      actionLabel: "Open Quotations",
      actionTarget: "quotations",
      actionPath: getActionPath("quotations"),
      evidence: [
        `${metrics.activeQuotesCount} active quotations`,
        `${formatCurrency(metrics.activeQuoteValue)} open quote value`,
      ],
    });
  }

  if (toNumber(metrics.closeSoonDealsCount) > 0 || toNumber(metrics.weightedPipeline) > 0) {
    opportunities.push({
      id: "fallback-opportunity-pipeline",
      title: "Weighted pipeline shows closeable value",
      message: `${formatCurrency(metrics.weightedPipeline)} of weighted forecast is active, with ${metrics.closeSoonDealsCount} deals expected to close soon.`,
      impact: "Focus on likely wins",
      severity: "medium",
      category: "Forecast Opportunity",
      actionLabel: "Open Deals",
      actionTarget: "deals",
      actionPath: getActionPath("deals"),
      evidence: [
        `${metrics.openDealsCount} open deals`,
        `${formatCurrency(metrics.weightedPipeline)} weighted pipeline`,
      ],
    });
  }

  recommendations.push(
    {
      id: "fallback-recommendation-next-step",
      title: "Tighten next-step ownership",
      message: "Make sure every active deal, quotation, and follow-up has a clear owner and next action. That is the fastest operational improvement available from the current data.",
      impact: "Better execution consistency",
      severity: "medium",
      category: "Next Best Action",
      actionLabel: "Open Deals",
      actionTarget: "deals",
      actionPath: getActionPath("deals"),
      evidence: [
        `${metrics.openDealsCount} open deals`,
        `${metrics.followupsCount} follow-up records in scope`,
      ],
    },
    {
      id: "fallback-recommendation-review",
      title: "Review stale and overdue records together",
      message: "Run one cleanup pass across stale leads and overdue follow-ups so the CRM reflects live selling activity instead of historical clutter.",
      impact: "Sharper pipeline visibility",
      severity: "low",
      category: "Pipeline Hygiene",
      actionLabel: "Open Leads",
      actionTarget: "leads",
      actionPath: getActionPath("leads"),
      evidence: [
        `${metrics.staleLeadsCount} stale leads`,
        `${metrics.overdueFollowupsCount} overdue follow-ups`,
      ],
    }
  );

  drivers.push(
    {
      id: "fallback-driver-pipeline",
      title: "Pipeline Coverage",
      value: formatCurrency(metrics.totalPipeline),
      message: `${metrics.openDealsCount} open deals are carrying the current pipeline.`,
    },
    {
      id: "fallback-driver-execution",
      title: "Execution Load",
      value: `${metrics.overdueFollowupsCount + metrics.dueTodayFollowupsCount}`,
      message: `${metrics.overdueFollowupsCount} overdue and ${metrics.dueTodayFollowupsCount} due today are shaping the immediate workload.`,
    },
    {
      id: "fallback-driver-conversion",
      title: "Conversion Signal",
      value: metrics.winRate == null ? "Not enough data" : `${metrics.winRate}%`,
      message:
        metrics.winRate == null
          ? "There are not enough closed deals yet to estimate win rate confidently."
          : `${metrics.wonDealsCount} won deals out of ${metrics.wonDealsCount + metrics.lostDealsCount} closed deals.`,
    }
  );

  coachQuestions.push(
    {
      id: "fallback-question-1",
      question: "Which overdue follow-ups still map to active revenue potential?",
      reason: "This helps separate real pipeline recovery work from administrative backlog.",
    },
    {
      id: "fallback-question-2",
      question: "Which open quotations are closest to a decision and what blocker is still unresolved?",
      reason: "Open quotations usually indicate stronger buying intent than early-stage lead activity.",
    }
  );

  outlook.push(
    {
      label: "Forecast Value",
      value: formatCurrency(metrics.weightedPipeline),
      note: "Estimated from open-deal probability data currently present in the CRM.",
    },
    {
      label: "Win Rate",
      value: metrics.winRate == null ? "N/A" : `${metrics.winRate}%`,
      note: "Based on closed deals in this scope.",
    },
    {
      label: "Quote Pressure",
      value: `${metrics.activeQuotesCount}`,
      note: `${formatCurrency(metrics.activeQuoteValue)} is active in quotations.`,
    },
    {
      label: "CRM Freshness",
      value: `${metrics.staleLeadsCount}`,
      note: "Leads needing renewed contact or closure.",
    }
  );

  const healthScore = Math.max(
    15,
    Math.min(
      92,
      Math.round(
        60 +
          Math.min(toNumber(metrics.winRate) / 5, 15) +
          Math.min(toNumber(metrics.activeQuotesCount) * 2, 10) -
          Math.min(toNumber(metrics.overdueFollowupsCount) * 4, 25) -
          Math.min(toNumber(metrics.staleLeadsCount) * 2, 18)
      )
    )
  );

  return {
    meta: {
      analysisMode: "fallback",
      fallbackReasonCode: "",
      fallbackReasonMessage: "",
    },
    summary: {
      role: titleCase(evidencePack.metadata.role),
      scope: evidencePack.metadata.scope,
      scopeLabel,
      analysisDate: evidencePack.metadata.analysisDate,
      healthScore,
      healthLabel: "Fallback CRM analysis",
      confidence: "Generated from live CRM evidence because the primary LLM provider was unavailable.",
      metrics,
    },
    narrative: {
      headline: `${scopeLabel} insights generated from CRM evidence`,
      summary: `${formatCurrency(metrics.totalPipeline)} in open pipeline, ${metrics.overdueFollowupsCount} overdue follow-ups, ${metrics.staleLeadsCount} stale leads, and ${formatCurrency(metrics.activeQuoteValue)} in active quotations are the strongest signals in this view. The primary AI provider was unavailable, so this report was built directly from current CRM data to keep the page operational.`,
      confidence: "This fallback mode is evidence-based and deterministic. Switches back to LLM analysis automatically when Gemini becomes available.",
      model: modelName,
    },
    overviewCards: evidencePack.fallbackOverviewCards,
    priorities: priorities.slice(0, 4),
    opportunities: opportunities.slice(0, 4),
    recommendations: recommendations.slice(0, 4),
    coachQuestions: coachQuestions.slice(0, 4),
    drivers: drivers.slice(0, 4),
    outlook: outlook.slice(0, 4),
    teamBoard: [],
    evidencePack,
  };
}

function extractJson(text = "") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("LLM returned an empty response");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response did not include valid JSON");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeEntry(item, index, prefix) {
  return {
    id: compactText(item?.id) || createId(prefix, index),
    title: compactText(item?.title) || "Untitled insight",
    message: compactText(item?.message) || "No explanation provided.",
    impact: compactText(item?.impact) || "Needs review",
    severity: sanitizeSeverity(item?.severity),
    category: compactText(item?.category) || titleCase(prefix),
    actionLabel: compactText(item?.actionLabel) || "Open",
    actionTarget: compactText(item?.actionTarget) || "ai_insights",
    actionPath: getActionPath(item?.actionTarget),
    evidence: Array.isArray(item?.evidence)
      ? item.evidence.map((entry) => compactText(entry)).filter(Boolean).slice(0, 3)
      : [],
  };
}

function normalizeQuestion(item, index) {
  return {
    id: compactText(item?.id) || createId("question", index),
    question: compactText(item?.question) || "What changed in this part of the pipeline?",
    reason: compactText(item?.reason) || "The AI flagged this as worth investigating.",
  };
}

function normalizeCard(item, index, fallbackCards) {
  const fallback = fallbackCards[index];
  return {
    label: compactText(item?.label) || fallback?.label || `Metric ${index + 1}`,
    value: compactText(item?.value) || fallback?.value || "-",
    note: compactText(item?.note) || fallback?.note || "",
  };
}

function normalizeOutlook(item, index) {
  return {
    label: compactText(item?.label) || `Outlook ${index + 1}`,
    value: compactText(item?.value) || "-",
    note: compactText(item?.note) || "",
  };
}

function normalizeDriver(item, index) {
  return {
    id: compactText(item?.id) || createId("driver", index),
    title: compactText(item?.title) || `Driver ${index + 1}`,
    value: compactText(item?.value) || "-",
    message: compactText(item?.message) || "No driver explanation provided.",
  };
}

function buildEvidencePack(data) {
  const role = normalizeRole(data?.role);
  const scope = normalizeScope(data?.scope, role);
  const scopeLabel = getScopeLabel(scope);
  const now = safeDate(data?.now) || new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const next14Days = new Date(today);
  next14Days.setDate(next14Days.getDate() + 14);

  const deals = Array.isArray(data?.deals) ? data.deals : [];
  const leads = Array.isArray(data?.leads) ? data.leads : [];
  const followups = Array.isArray(data?.followups) ? data.followups : [];
  const meetings = Array.isArray(data?.meetings) ? data.meetings : [];
  const quotations = Array.isArray(data?.quotations) ? data.quotations : [];
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const teamSummaries = Array.isArray(data?.teamSummaries) ? data.teamSummaries : [];

  const openDeals = deals.filter((deal) => String(deal?.status || "").toLowerCase() === "open");
  const wonDeals = deals.filter((deal) => String(deal?.status || "").toLowerCase() === "won");
  const lostDeals = deals.filter((deal) => String(deal?.status || "").toLowerCase() === "lost");
  const closedDeals = wonDeals.length + lostDeals.length;

  const overdueFollowups = followups.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    const due = safeDate(item?.dueDateTime);
    return status !== "completed" && status !== "cancelled" && due && due < now;
  });

  const dueTodayFollowups = followups.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    const due = safeDate(item?.dueDateTime);
    if (status === "completed" || status === "cancelled" || !due) return false;
    return due >= today && due < new Date(today.getTime() + 24 * 60 * 60 * 1000);
  });

  const activeQuotes = quotations.filter((quote) =>
    ["draft", "sent", "viewed", "negotiation"].includes(String(quote?.status || "").toLowerCase())
  );

  const staleLeads = leads.filter((lead) => {
    const age = daysBetween(now, lead?.last_contact_date);
    return age === null || age > 30;
  });

  const dealsClosingSoon = openDeals.filter((deal) => {
    const closeDate = safeDate(deal?.expectedCloseDate);
    return closeDate && closeDate >= today && closeDate <= next14Days;
  });

  const weightedPipeline = openDeals.reduce((sum, deal) => {
    const value = toNumber(deal?.dealValue);
    const probability = toNumber(deal?.probability);
    return sum + value * (probability > 0 ? probability / 100 : 0.35);
  }, 0);

  const metrics = {
    role: titleCase(role),
    scope,
    scopeLabel,
    analysisDate: now.toISOString(),
    dealsCount: deals.length,
    openDealsCount: openDeals.length,
    wonDealsCount: wonDeals.length,
    lostDealsCount: lostDeals.length,
    leadsCount: leads.length,
    staleLeadsCount: staleLeads.length,
    hotLeadsCount: leads.filter((lead) => String(lead?.lead_temperature || "").toLowerCase() === "hot").length,
    followupsCount: followups.length,
    overdueFollowupsCount: overdueFollowups.length,
    dueTodayFollowupsCount: dueTodayFollowups.length,
    meetingsCount: meetings.length,
    activeQuotesCount: activeQuotes.length,
    clientsCount: clients.length,
    totalPipeline: openDeals.reduce((sum, deal) => sum + toNumber(deal?.dealValue), 0),
    weightedPipeline,
    wonRevenue: wonDeals.reduce((sum, deal) => sum + toNumber(deal?.dealValue), 0),
    activeQuoteValue: activeQuotes.reduce(
      (sum, quote) => sum + toNumber(quote?.grandTotal ?? quote?.totalAmount),
      0
    ),
    expenseValue30d: expenses
      .filter((expense) => {
        const expenseDate = safeDate(expense?.expenseDate || expense?.createdAt);
        return expenseDate && daysBetween(now, expenseDate) <= 30;
      })
      .reduce((sum, expense) => sum + toNumber(expense?.totalAmount ?? expense?.amount), 0),
    winRate:
      closedDeals > 0 ? Math.round((wonDeals.length / closedDeals) * 100) : null,
    closeSoonDealsCount: dealsClosingSoon.length,
  };

  const samples = {
    topOpenDeals: pickTop(
      openDeals.map((deal) => ({
        title: compactText(deal?.dealName || deal?.title || deal?.clientName || "Untitled deal"),
        stage: compactText(deal?.stage || deal?.dealStage || deal?.status || "unknown"),
        value: toNumber(deal?.dealValue),
        probability: toNumber(deal?.probability),
        expectedCloseDate: safeDate(deal?.expectedCloseDate)?.toISOString() || null,
      })),
      6,
      (a, b) => b.value - a.value || b.probability - a.probability
    ),
    staleLeads: pickTop(
      staleLeads.map((lead) => ({
        name: compactText(lead?.leadName || lead?.name || lead?.companyName || "Unnamed lead"),
        company: compactText(lead?.company || lead?.companyName),
        source: compactText(lead?.leadSource || lead?.source),
        temperature: compactText(lead?.lead_temperature || "unknown"),
        daysSinceLastContact: daysBetween(now, lead?.last_contact_date),
      })),
      6,
      (a, b) => (b.daysSinceLastContact || 0) - (a.daysSinceLastContact || 0)
    ),
    overdueFollowups: pickTop(
      overdueFollowups.map((item) => ({
        title: compactText(item?.title || item?.subject || "Follow-up"),
        status: compactText(item?.status || "pending"),
        dueDateTime: safeDate(item?.dueDateTime)?.toISOString() || null,
        daysOverdue: daysBetween(now, item?.dueDateTime),
      })),
      6,
      (a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0)
    ),
    activeQuotations: pickTop(
      activeQuotes.map((quote) => ({
        quoteNumber: compactText(quote?.quotationNumber || quote?.quoteNumber || quote?._id),
        client: compactText(quote?.clientName || quote?.companyName || "Unknown client"),
        status: compactText(quote?.status || "open"),
        amount: toNumber(quote?.grandTotal ?? quote?.totalAmount),
      })),
      6,
      (a, b) => b.amount - a.amount
    ),
    upcomingMeetings: pickTop(
      meetings
        .map((meeting) => {
          const when = safeDate(meeting?.startTime || meeting?.meetingDate);
          return {
            title: compactText(meeting?.title || meeting?.meetingTitle || "Meeting"),
            date: when?.toISOString() || null,
            daysFromNow:
              when ? Math.floor((when.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null,
          };
        })
        .filter((meeting) => meeting.date),
      5,
      (a, b) => (a.daysFromNow || 9999) - (b.daysFromNow || 9999)
    ),
    topExpenses30d: pickTop(
      expenses
        .map((expense) => ({
          category: compactText(expense?.category || expense?.expenseCategory || "Expense"),
          amount: toNumber(expense?.totalAmount ?? expense?.amount),
          date: safeDate(expense?.expenseDate || expense?.createdAt)?.toISOString() || null,
        }))
        .filter((expense) => expense.date && daysBetween(now, expense.date) <= 30),
      5,
      (a, b) => b.amount - a.amount
    ),
    teams: pickTop(
      teamSummaries.map((team) => ({
        name: compactText(team?.name || "Unnamed Team"),
        members: toNumber(team?.membersCount),
        pipelineValue: toNumber(team?.pipelineValue),
        openDeals: toNumber(team?.openDeals),
        staleLeads: toNumber(team?.staleLeads),
        overdueFollowups: toNumber(team?.overdueFollowups),
        winRate: toNumber(team?.winRate),
      })),
      6,
      (a, b) => b.pipelineValue - a.pipelineValue || a.overdueFollowups - b.overdueFollowups
    ),
  };

  return {
    metadata: {
      role,
      scope,
      scopeLabel,
      teamName: data.teamName || "",
      analysisDate: now.toISOString(),
    },
    metrics,
    samples,
    fallbackOverviewCards: buildMetricCards(metrics),
  };
}

function buildPrompt(evidencePack) {
  const roleName = String(evidencePack.metadata.role || "").toLowerCase();
  const teamName = evidencePack.metadata.teamName || "";
  
  let persona = "You are an expert sales operations analyst inside a CRM product.";
  if (roleName === "admin") {
    persona = "You are a Strategic Sales Director providing high-level company-wide intelligence and performance analysis for the executive board.";
  } else if (roleName === "manager") {
    persona = `You are a Sales Team Coach for the "${teamName || "assigned"}" team, providing tactical guidance to improve team momentum, execution discipline, and member performance.`;
  } else if (roleName === "user" || roleName === "sales person" || roleName === "salesperson") {
    persona = "You are a Professional Sales Productivity Coach, providing personal focus tips and deal acceleration strategies to help the salesperson hit their targets.";
  }

  const instructions = [
    persona,
    "Use only the evidence provided. Do not invent entities, numbers, trends, or meetings.",
    "If evidence is weak or incomplete, say that clearly instead of guessing.",
    "Return JSON only. No markdown, no code fences, no extra text.",
    "If evidence is weak, state that clearly in the summary.",
    "Your response must be a valid JSON object strictly matching the provided schema.",
    "Keep insights grounded in this CRM data and make the advice operational.",
    "Severity must be one of: high, medium, low.",
    "Allowed actionTarget values: deals, leads, followups, quotations, meetings, expenses, clients, team_dashboard, ai_insights, calendar.",
    "Severity must be one of: high, medium, low.",
    "For overviewCards and outlook values, prefer concise human-readable strings.",
    "Health score should reflect CRM execution quality on a 0-100 scale.",
  ].join(" ");

  const schema = {
    summary: {
      healthScore: 0,
      healthLabel: "Needs attention",
      confidence: "High confidence based on complete CRM evidence.",
    },
    narrative: {
      headline: "Short executive headline",
      summary: "2-4 sentence executive brief grounded in the evidence",
    },
    overviewCards: [
      { label: "Metric label", value: "Metric value", note: "Why it matters" },
    ],
    priorities: [
      {
        id: "priority-1",
        title: "Priority title",
        message: "What is happening and why it matters",
        impact: "Short outcome phrase",
        severity: "high",
        category: "Priority",
        actionLabel: "Open follow-ups",
        actionTarget: "followups",
        evidence: ["Evidence point 1", "Evidence point 2"],
      },
    ],
    opportunities: [
      {
        id: "opportunity-1",
        title: "Opportunity title",
        message: "What to pursue",
        impact: "Short outcome phrase",
        severity: "medium",
        category: "Opportunity",
        actionLabel: "Open quotations",
        actionTarget: "quotations",
        evidence: ["Evidence point 1"],
      },
    ],
    recommendations: [
      {
        id: "recommendation-1",
        title: "Recommended action",
        message: "Specific next move",
        impact: "Expected result",
        severity: "medium",
        category: "Next Best Action",
        actionLabel: "Open deals",
        actionTarget: "deals",
        evidence: ["Evidence point 1"],
      },
    ],
    coachQuestions: [
      {
        id: "question-1",
        question: "Question for the seller or manager",
        reason: "Why asking it matters",
      },
    ],
    drivers: [
      {
        id: "driver-1",
        title: "Driver title",
        value: "Concise value",
        message: "Why this driver matters",
      },
    ],
    outlook: [
      {
        label: "Outlook item",
        value: "Value",
        note: "Interpretation",
      },
    ],
  };

  return `${instructions}\n\nSchema:\n${JSON.stringify(schema, null, 2)}\n\nEvidence:\n${JSON.stringify(
    evidencePack,
    null,
    2
  )}`;
}

class AIInsightService {
  constructor() {
    this.modelName = "gemini-1.5-flash";
    this.modelCandidates = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];
    this.client = process.env.GEMINI_API_KEY
      ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      : null;
  }

  getClient() {
    if (this.client) return this.client;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AIInsightError(
        "AI Insights is not configured because GEMINI_API_KEY is missing.",
        503,
        "AI_INSIGHTS_CONFIG_MISSING"
      );
    }

    this.client = new GoogleGenerativeAI(apiKey);
    return this.client;
  }

  async requestInsightReport(evidencePack) {
    try {
      const client = this.getClient();
      let lastError = null;

      for (const modelName of this.modelCandidates) {
        try {
          const model = client.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: 0.4,
              topP: 0.9,
              responseMimeType: "application/json",
            },
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          });

          const result = await model.generateContent(buildPrompt(evidencePack));
          const text = result?.response?.text?.();
          this.modelName = modelName;
          return extractJson(text);
        } catch (modelError) {
          lastError = modelError;
          console.warn(`AI Insights model attempt failed for ${modelName}:`, modelError?.message || modelError);
        }
      }

      throw lastError || new Error("No Gemini model could generate AI insights.");
    } catch (error) {
      if (error instanceof AIInsightError) {
        throw error;
      }

      const message = String(error?.message || "");

      if (
        message.includes("fetch failed") ||
        message.includes("NetworkError") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNRESET")
      ) {
        throw new AIInsightError(
          "AI Insights could not reach Gemini. Check server internet access and Gemini availability.",
          503,
          "AI_INSIGHTS_UPSTREAM_UNAVAILABLE",
          error
        );
      }

      if (
        message.includes("API key") ||
        message.includes("API_KEY") ||
        message.includes("permission") ||
        message.includes("quota") ||
        message.includes("429") ||
        message.includes("403")
      ) {
        throw new AIInsightError(
          "AI Insights could not authenticate with Gemini. Check the API key, quota, and model access.",
          503,
          "AI_INSIGHTS_AUTH_FAILED",
          error
        );
      }

      if (
        message.includes("empty response") ||
        message.includes("valid JSON") ||
        error instanceof SyntaxError
      ) {
        throw new AIInsightError(
          "AI Insights received an invalid response from Gemini. Please retry the analysis.",
          502,
          "AI_INSIGHTS_BAD_MODEL_RESPONSE",
          error
        );
      }

      throw new AIInsightError(
        "AI Insights failed while generating the model response.",
        500,
        "AI_INSIGHTS_REQUEST_FAILED",
        error
      );
    }
  }

  normalizeResponse(llmResponse, evidencePack, teamSummaries) {
    const fallbackOverviewCards = evidencePack.fallbackOverviewCards;
    const summary = {
      role: titleCase(evidencePack.metadata.role),
      scope: evidencePack.metadata.scope,
      scopeLabel: evidencePack.metadata.scopeLabel,
      analysisDate: evidencePack.metadata.analysisDate,
      healthScore: Math.max(0, Math.min(100, Math.round(toNumber(llmResponse?.summary?.healthScore)))),
      healthLabel: compactText(llmResponse?.summary?.healthLabel) || "Needs review",
      confidence:
        compactText(llmResponse?.summary?.confidence) ||
        "Confidence is limited to CRM records currently available in this scope.",
      metrics: evidencePack.metrics,
    };

    return {
      meta: {
        analysisMode: "llm",
        fallbackReasonCode: "",
        fallbackReasonMessage: "",
      },
      summary,
      narrative: {
        headline: compactText(llmResponse?.narrative?.headline) || "AI CRM analysis",
        summary:
          compactText(llmResponse?.narrative?.summary) ||
          "The AI could not produce a detailed narrative for this scope.",
        confidence: summary.confidence,
        model: this.modelName,
      },
      overviewCards: Array.isArray(llmResponse?.overviewCards) && llmResponse.overviewCards.length
        ? llmResponse.overviewCards.slice(0, 4).map((item, index) => normalizeCard(item, index, fallbackOverviewCards))
        : fallbackOverviewCards,
      priorities: Array.isArray(llmResponse?.priorities)
        ? llmResponse.priorities.slice(0, 4).map((item, index) => normalizeEntry(item, index, "priority"))
        : [],
      opportunities: Array.isArray(llmResponse?.opportunities)
        ? llmResponse.opportunities
          .slice(0, 4)
          .map((item, index) => normalizeEntry(item, index, "opportunity"))
        : [],
      recommendations: Array.isArray(llmResponse?.recommendations)
        ? llmResponse.recommendations
          .slice(0, 4)
          .map((item, index) => normalizeEntry(item, index, "recommendation"))
        : [],
      coachQuestions: Array.isArray(llmResponse?.coachQuestions)
        ? llmResponse.coachQuestions.slice(0, 4).map(normalizeQuestion)
        : [],
      drivers: Array.isArray(llmResponse?.drivers)
        ? llmResponse.drivers.slice(0, 4).map(normalizeDriver)
        : [],
      outlook: Array.isArray(llmResponse?.outlook)
        ? llmResponse.outlook.slice(0, 4).map(normalizeOutlook)
        : [],
      teamBoard: pickTop(
        (Array.isArray(teamSummaries) ? teamSummaries : []).map((team) => ({
          id: team.id,
          name: team.name,
          members: team.membersCount,
          pipelineValue: team.pipelineValue,
          openDeals: team.openDeals,
          staleLeads: team.staleLeads,
          overdueFollowups: team.overdueFollowups,
          winRate: team.winRate,
        })),
        5,
        (a, b) => b.pipelineValue - a.pipelineValue || a.overdueFollowups - b.overdueFollowups
      ),
      evidencePack,
    };
  }

  async generateExpandedInsights(data) {
    const evidencePack = buildEvidencePack(data);
    evidencePack.metadata.teamName = data.teamName || "";

    if (!hasMeaningfulCrmData(evidencePack.metrics)) {
      return buildEmptyInsightResponse(evidencePack, this.modelName);
    }

    try {
      const llmResponse = await this.requestInsightReport(evidencePack);
      return this.normalizeResponse(llmResponse, evidencePack, data?.teamSummaries);
    } catch (error) {
      if (
        error?.code === "AI_INSIGHTS_UPSTREAM_UNAVAILABLE" ||
        error?.code === "AI_INSIGHTS_AUTH_FAILED" ||
        error?.code === "AI_INSIGHTS_BAD_MODEL_RESPONSE" ||
        error?.code === "AI_INSIGHTS_REQUEST_FAILED" ||
        error?.code === "AI_INSIGHTS_REQUEST_FAILED" ||
        error?.code === "AI_INSIGHTS_CONFIG_MISSING"
      ) {
        console.warn(
          `AI Insights falling back to offline evidence mode because ${error.code}:`,
          error?.message || error
        );
        const fallbackResponse = buildOfflineFallbackResponse(evidencePack);
        fallbackResponse.meta = {
          analysisMode: "fallback",
          fallbackReasonCode: error?.code || "AI_INSIGHTS_FALLBACK",
          fallbackReasonMessage:
            error?.message || "Primary AI provider was unavailable, so CRM fallback analysis was used.",
        };
        return fallbackResponse;
      }

      throw error;
    }
  }

  async generateInsights(data) {
    const response = await this.generateExpandedInsights(data);
    return response.priorities;
  }
}

module.exports = new AIInsightService();
