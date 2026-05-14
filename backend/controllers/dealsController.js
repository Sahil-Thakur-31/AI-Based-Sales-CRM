const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const User = require("../models/users");
const Followup = require("../models/followUp");
const Location = require("../models/location");
const DealStageHistory = require("../models/dealStageHistory");
const SalesTarget = require("../models/sales_targets");
const Team = require("../models/teams");

const DEAL_WON_STAGE = "P7";
const DEAL_LOST_STAGE = "P6";

function mapTemperatureFromLead(lead) {
  const temp = (lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return { ai_score: 90, lead_temperature: "hot" };
  if (temp === "warm") return { ai_score: 70, lead_temperature: "warm" };
  return { ai_score: 50, lead_temperature: "cold" };
}

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchFollowupInsightsByField(fieldName, ids = []) {
  if (!ids.length) {
    return { nextMap: new Map(), lastMap: new Map() };
  }

  const followups = await Followup.find({
    [fieldName]: { $in: ids },
    is_deleted: false,
  })
    .select(`${fieldName} status dueDateTime lastContactDate completedAt createdAt`)
    .lean();

  const nextMap = new Map();
  const lastMap = new Map();

  for (const followup of followups) {
    const entityId = followup?.[fieldName]?.toString();
    if (!entityId) continue;

    if (["pending", "overdue"].includes(String(followup.status || "").toLowerCase())) {
      const existing = nextMap.get(entityId);
      const currentDue = toValidDate(followup.dueDateTime);
      const existingDue = toValidDate(existing?.dueDateTime);
      if (!existing || (currentDue && (!existingDue || currentDue < existingDue))) {
        nextMap.set(entityId, followup);
      }
    }

    const candidates = [
      toValidDate(followup.lastContactDate),
      toValidDate(followup.completedAt),
      toValidDate(followup.createdAt),
    ].filter(Boolean);
    if (!candidates.length) continue;
    const latestForFollowup = new Date(Math.max(...candidates.map((d) => d.getTime())));
    const previous = toValidDate(lastMap.get(entityId));
    if (!previous || latestForFollowup > previous) {
      lastMap.set(entityId, latestForFollowup);
    }
  }

  return { nextMap, lastMap };
}

async function isAdminAssignee(userId) {
  if (!userId) return false;
  const user = await User.findOne({
    _id: userId,
    is_deleted: { $ne: true },
  })
    .populate("role", "name")
    .select("role")
    .lean();
  const roleName = String(user?.role?.name || "").toLowerCase();
  return roleName === "admin";
}

function getRoleName(user = {}) {
  return String(user?.role || "").trim().toLowerCase();
}

function isPrivilegedUser(user = {}) {
  const roleName = getRoleName(user);
  return roleName === "admin" || roleName === "manager";
}

async function getAccessibleLeadIdsForUser(userId) {
  if (!userId) return [];
  const leadIds = await Leads.find({ assigned_to: userId }).distinct("_id");
  return leadIds;
}

async function buildDealAccessFilter(user = {}, baseFilter = {}) {
  if (isPrivilegedUser(user)) return { ...baseFilter };

  const userId = user?._id || null;
  const leadIds = await getAccessibleLeadIdsForUser(userId);
  return {
    ...baseFilter,
    $or: [
      { assignedTo: userId },
      { lead_id: { $in: leadIds } },
    ],
  };
}

function buildAggregationIdMatches(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return [];

  const values = [rawValue];
  if (mongoose.Types.ObjectId.isValid(rawValue)) {
    values.push(new mongoose.Types.ObjectId(rawValue));
  }

  return values;
}

async function buildDealAggregateAccessFilter(user = {}, baseFilter = {}) {
  if (isPrivilegedUser(user)) return { ...baseFilter };

  const userId = user?._id || null;
  const leadIds = await getAccessibleLeadIdsForUser(userId);
  const assignedToValues = buildAggregationIdMatches(userId);
  const normalizedLeadIds = [...new Set(
    leadIds
      .flatMap((leadId) => buildAggregationIdMatches(leadId))
      .map((leadId) => String(leadId))
  )].map((leadId) =>
    mongoose.Types.ObjectId.isValid(leadId)
      ? new mongoose.Types.ObjectId(leadId)
      : leadId
  );

  return {
    ...baseFilter,
    $or: [
      { assignedTo: { $in: assignedToValues } },
      { lead_id: { $in: normalizedLeadIds } },
    ],
  };
}

async function resolveLocationId(payload = {}) {
  const normalized = {
    country: String(payload.country || "").trim(),
    State: String(payload.State || "").trim(),
    city: String(payload.city || "").trim(),
    zone: String(payload.zone || "").trim(),
  };

  const hasAnyLocation = Object.values(normalized).some(Boolean);
  if (!hasAnyLocation) return null;

  let location = await Location.findOne(normalized).lean();
  if (location?._id) return location._id;

  location = await Location.create(normalized);
  return location._id;
}

function normalizeContactRows(contacts = []) {
  if (!Array.isArray(contacts)) return [];
  const validContacts = contacts.filter((contact) => contact && (contact.name || (contact.phone && contact.phone.length) || (contact.email && contact.email.length)));
  const hasPrimary = validContacts.some((contact) => contact.is_primary === true || contact.is_primary === "true");

  return validContacts.map((contact, index) => {
    let phoneArr = Array.isArray(contact.phone) ? contact.phone : (typeof contact.phone === 'string' ? contact.phone.split(",") : []);
    let emailArr = Array.isArray(contact.email) ? contact.email : (typeof contact.email === 'string' ? contact.email.split(",") : []);
    return {
      name: contact.name || "",
      designation: contact.designation || "",
      phone: phoneArr.map(p => String(p).trim()).filter(Boolean).join(", "),
      email: emailArr.map(e => String(e).trim()).filter(Boolean).join(", "),
      linkedin: contact.linkedin || "",
      address: contact.address || "",
      is_primary: hasPrimary ? (contact.is_primary === true || contact.is_primary === "true") : index === 0,
    };
  });
}

function buildLeadUpdatePayload(body = {}) {
  const update = {};
  const objectIdLikeFields = new Set([
    "source",
    "referred_by_user",
    "expo_event_id",
    "assigned_to",
    "location",
  ]);
  const leadFields = [
    "company_name",
    "industry",
    "employee_count",
    "turnover_range",
    "Address",
    "website",
    "source",
    "referred_by_user",
    "expo_event_id",
    "lead_temperature",
    "next_action",
    "last_contact_date",
    "assigned_to",
    "reason_for_lost",
  ];

  for (const field of leadFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const rawValue = body[field];
      update[field] =
        objectIdLikeFields.has(field) && (rawValue === "" || rawValue === undefined)
          ? null
          : rawValue;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "deal_value_estimate")) {
    const amount = Number(body.deal_value_estimate);
    update.deal_value_estimate = Number.isFinite(amount) ? amount : 0;
  }

  return update;
}

function getCompanyName(deal = {}, lead = null, client = null) {
  return (
    client?.name ||
    lead?.company_name ||
    deal?.clientName ||
    ""
  );
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date = new Date()) {
  const value = startOfDay(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfQuarter(date = new Date()) {
  const month = date.getMonth();
  const quarterStartMonth = month - (month % 3);
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addYears(date, years) {
  return new Date(date.getFullYear() + years, 0, 1);
}

const SALES_QUARTER_GROUPS = {
  q1: { label: "Q1", startMonth: 0 },
  q2: { label: "Q2", startMonth: 3 },
  q3: { label: "Q3", startMonth: 6 },
  q4: { label: "Q4", startMonth: 9 },
};

function normalizeSalesReportPeriod(period) {
  const value = String(period || "monthly").trim().toLowerCase();
  if (value === "weekly" || value === "week") return "weekly";
  if (value === "quarterly" || value === "quarter") return "quarterly";
  if (value === "yearly" || value === "year") return "yearly";
  return "monthly";
}

function normalizeSalesReportYear(year, now = new Date()) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 9999) {
    return now.getFullYear();
  }
  return parsed;
}

function normalizeSalesReportMonth(month, now = new Date()) {
  const parsed = Number.parseInt(month, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return now.getMonth() + 1;
  }
  return parsed;
}

function normalizeSalesReportQuarter(quarter, now = new Date()) {
  const value = String(quarter || "").trim().toLowerCase();
  if (SALES_QUARTER_GROUPS[value]) {
    return value;
  }

  const month = now.getMonth();
  if (month < 3) return "q1";
  if (month < 6) return "q2";
  if (month < 9) return "q3";
  return "q4";
}

function normalizeSalesReportAssignee(assignedTo) {
  const value = String(assignedTo || "").trim();
  if (!value || value.toLowerCase() === "all") {
    return null;
  }
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value;
}

function getUserRoleName(userDoc = {}) {
  return String(userDoc?.role?.name || userDoc?.role || "").trim().toLowerCase();
}

async function resolveSalesAssigneeScope(assignedToInput) {
  const assignedTo = normalizeSalesReportAssignee(assignedToInput);
  if (!assignedTo) {
    return {
      selectedUser: null,
      roleName: "",
      isManagerScope: false,
      dealFilter: {},
      leadFilter: {},
    };
  }

  const selectedUser = await User.findOne({
    _id: assignedTo,
    is_deleted: { $ne: true },
  })
    .populate("role", "name")
    .select("name email role")
    .lean();

  return {
    selectedUser,
    roleName: getUserRoleName(selectedUser),
    isManagerScope: false,
    dealFilter: { assignedTo },
    leadFilter: { assigned_to: assignedTo },
  };
}

async function getManagerTeamScopeFilters(user = {}) {
  if (getRoleName(user) !== "manager" || !user?._id) {
    return { dealFilter: {}, leadFilter: {} };
  }

  const teams = await Team.find({ "teamLeads.userId": user._id })
    .select("teamLeads members")
    .lean();

  const scopedIds = [
    String(user._id),
    ...teams.flatMap((team) => [
      ...(team.teamLeads || []).map((lead) => String(lead.userId || "")),
      ...(team.members || []).map((member) => String(member.userId || "")),
    ]),
  ].filter(Boolean);

  const objectIds = [...new Set(scopedIds)]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectIds.length) {
    return {
      dealFilter: { assignedTo: user._id },
      leadFilter: { assigned_to: user._id },
    };
  }

  return {
    dealFilter: { assignedTo: { $in: objectIds } },
    leadFilter: { assigned_to: { $in: objectIds } },
  };
}

async function getTeamScopeFiltersForManagerId(managerId) {
  if (!managerId) {
    return { dealFilter: {}, leadFilter: {} };
  }

  const teams = await Team.find({ "teamLeads.userId": managerId })
    .select("teamLeads members")
    .lean();

  const scopedIds = [
    String(managerId),
    ...teams.flatMap((team) => [
      ...(team.teamLeads || []).map((lead) => String(lead.userId || "")),
      ...(team.members || []).map((member) => String(member.userId || "")),
    ]),
  ].filter(Boolean);

  const objectIds = [...new Set(scopedIds)]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectIds.length) {
    return {
      dealFilter: { assignedTo: managerId },
      leadFilter: { assigned_to: managerId },
    };
  }

  return {
    dealFilter: { assignedTo: { $in: objectIds } },
    leadFilter: { assigned_to: { $in: objectIds } },
  };
}

async function getSalesTargetSummary(userId, periodType, rangeStart, rangeEnd) {
  if (!userId) return null;

  const targetDocs = await SalesTarget.find({
    user_id: userId,
    $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }],
    status: { $ne: "archived" },
    period_type: periodType,
    period_start: { $lte: rangeEnd },
    period_end: { $gte: rangeStart },
  })
    .sort({ updated_at: -1, created_at: -1 })
    .lean();

  const targetMap = new Map();
  for (const doc of targetDocs) {
    const key = [
      String(doc.period_type || ""),
      new Date(doc.period_start).toISOString(),
      new Date(doc.period_end).toISOString(),
    ].join(":");
    if (!targetMap.has(key)) {
      targetMap.set(key, doc);
    }
  }

  const effectiveTargets = [...targetMap.values()];
  const assignedValue = effectiveTargets.reduce(
    (sum, doc) => sum + Number(doc?.revenue_target || 0),
    0
  );
  const assignedDeals = effectiveTargets.reduce(
    (sum, doc) => sum + Number(doc?.deal_target || 0),
    0
  );

  const wonDealRows = await Deal.aggregate([
    {
      $match: {
        assignedTo: userId,
        stage: DEAL_WON_STAGE,
        is_deleted: { $ne: true },
      },
    },
    {
      $addFields: {
        closedAt: {
          $ifNull: ["$actualCloseDate", "$updatedAt"],
        },
      },
    },
    {
      $match: {
        closedAt: { $gte: rangeStart, $lt: rangeEnd },
      },
    },
    {
      $project: {
        _id: 1,
        dealValue: { $ifNull: ["$dealValue", 0] },
      },
    },
  ]);

  const wonDealIds = wonDealRows.map((row) => row._id).filter(Boolean);
  const completedValue = wonDealRows.reduce(
    (sum, row) => sum + Math.max(0, Number(row?.dealValue || 0)),
    0
  );

  return {
    revenueTarget: assignedValue,
    dealTarget: assignedDeals,
    completedValue,
    achievedDeals: wonDealIds.length,
    progressPercent: assignedValue
      ? Math.min(100, Math.round((completedValue / assignedValue) * 100))
      : 0,
  };
}

function getSalesReportSelection(input, now = new Date()) {
  if (typeof input === "string") {
    const period = normalizeSalesReportPeriod(input);
    return {
      period,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      quarter: normalizeSalesReportQuarter("", now),
    };
  }

  const period = normalizeSalesReportPeriod(input?.period);
  return {
    period,
    year: normalizeSalesReportYear(input?.year, now),
    month: normalizeSalesReportMonth(input?.month, now),
    quarter: normalizeSalesReportQuarter(input?.quarter, now),
  };
}

function getSalesReportRanges(input, now = new Date()) {
  const selection = getSalesReportSelection(input, now);
  const normalizedPeriod = selection.period;

  if (normalizedPeriod === "weekly") {
    const currentStart = startOfWeek(now);
    return {
      period: normalizedPeriod,
      currentStart,
      currentEnd: addDays(currentStart, 7),
      previousStart: addDays(currentStart, -7),
      previousEnd: currentStart,
      comparisonLabel: "last week",
    };
  }

  if (normalizedPeriod === "quarterly") {
    const currentStart = new Date(
      selection.year,
      SALES_QUARTER_GROUPS[selection.quarter].startMonth,
      1
    );
    return {
      period: normalizedPeriod,
      quarter: selection.quarter,
      year: selection.year,
      currentStart,
      currentEnd: addMonths(currentStart, 3),
      previousStart: addMonths(currentStart, -3),
      previousEnd: currentStart,
      comparisonLabel: "previous quarter",
    };
  }

  if (normalizedPeriod === "yearly") {
    const currentStart = new Date(selection.year, 0, 1);
    return {
      period: normalizedPeriod,
      year: selection.year,
      currentStart,
      currentEnd: new Date(selection.year + 1, 0, 1),
      previousStart: new Date(selection.year - 1, 0, 1),
      previousEnd: currentStart,
      comparisonLabel: "previous year",
    };
  }

  const currentStart = new Date(selection.year, selection.month - 1, 1);
  return {
    period: "monthly",
    month: selection.month,
    year: selection.year,
    currentStart,
    currentEnd: addMonths(currentStart, 1),
    previousStart: addMonths(currentStart, -1),
    previousEnd: currentStart,
    comparisonLabel: "previous month",
  };
}

function mergeMongoFilters(...filters) {
  const activeFilters = filters.filter(
    (filter) => filter && typeof filter === "object" && Object.keys(filter).length
  );
  if (!activeFilters.length) return {};
  if (activeFilters.length === 1) return activeFilters[0];
  return { $and: activeFilters };
}

function roundMetric(value, digits = 1) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  const factor = 10 ** digits;
  return Math.round(amount * factor) / factor;
}

function calculateGrowthPercentage(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  if (!previous) {
    if (!current) return 0;
    return 100;
  }

  return roundMetric(((current - previous) / previous) * 100, 1);
}

async function aggregateWonRevenue(accessFilter, start, end) {
  const [row] = await Deal.aggregate([
    { $match: accessFilter },
    {
      $addFields: {
        closedAt: {
          $ifNull: ["$actualCloseDate", "$updatedAt"],
        },
      },
    },
    {
      $match: {
        stage: DEAL_WON_STAGE,
        closedAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $ifNull: ["$dealValue", 0] } },
        wonDeals: { $sum: 1 },
      },
    },
  ]);

  return {
    revenue: Number(row?.revenue || 0),
    wonDeals: Number(row?.wonDeals || 0),
  };
}

async function aggregateClosedDealStats(accessFilter, start, end) {
  const rows = await Deal.aggregate([
    { $match: accessFilter },
    {
      $addFields: {
        closedAt: {
          $ifNull: ["$actualCloseDate", "$updatedAt"],
        },
      },
    },
    {
      $match: {
        stage: { $in: [DEAL_WON_STAGE, DEAL_LOST_STAGE] },
        closedAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: "$stage",
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = rows.reduce(
    (acc, row) => {
      if (row?._id === DEAL_WON_STAGE) acc.wonDeals = Number(row.count || 0);
      if (row?._id === DEAL_LOST_STAGE) acc.lostDeals = Number(row.count || 0);
      return acc;
    },
    { wonDeals: 0, lostDeals: 0 }
  );

  return {
    wonDeals: stats.wonDeals,
    lostDeals: stats.lostDeals,
    closedDeals: stats.wonDeals + stats.lostDeals,
  };
}

async function aggregateSalesCycle(accessFilter, start, end) {
  const [row] = await Deal.aggregate([
    { $match: accessFilter },
    {
      $addFields: {
        closedAt: {
          $ifNull: ["$actualCloseDate", "$updatedAt"],
        },
      },
    },
    {
      $match: {
        stage: DEAL_WON_STAGE,
        closedAt: { $gte: start, $lt: end },
      },
    },
    {
      $project: {
        cycleDays: {
          $divide: [
            { $subtract: ["$closedAt", "$createdAt"] },
            1000 * 60 * 60 * 24,
          ],
        },
      },
    },
    {
      $match: {
        cycleDays: { $gte: 0 },
      },
    },
    {
      $group: {
        _id: null,
        avgDays: { $avg: "$cycleDays" },
        sampleSize: { $sum: 1 },
      },
    },
  ]);

  return {
    avgDays: Number(row?.avgDays || 0),
    sampleSize: Number(row?.sampleSize || 0),
  };
}

async function aggregateLeadCohortConversion(leadFilter, start, end) {
  const cohortLeads = await Leads.find({
    ...leadFilter,
    is_deleted: { $ne: true },
    created_at: { $gte: start, $lt: end },
  })
    .select("_id converted_to_deal converted_deal_id stage")
    .lean();

  const leadCount = cohortLeads.length;
  if (!leadCount) {
    return {
      leadCount: 0,
      dealCount: 0,
      wonCount: 0,
      leadToDeal: 0,
      dealToWon: 0,
      overall: 0,
    };
  }

  const convertedDealIds = [
    ...new Set(
      cohortLeads
        .filter(
          (lead) =>
            lead?.converted_deal_id &&
            (lead?.converted_to_deal === true ||
              String(lead?.stage || "").toUpperCase() === "P7")
        )
        .map((lead) => String(lead.converted_deal_id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const dealCount = convertedDealIds.length;
  const wonCount = dealCount
    ? await Deal.countDocuments({
        _id: { $in: convertedDealIds },
        stage: DEAL_WON_STAGE,
        is_deleted: { $ne: true },
      })
    : 0;

  return {
    leadCount,
    dealCount,
    wonCount,
    leadToDeal: leadCount ? Math.round((dealCount / leadCount) * 100) : 0,
    dealToWon: dealCount ? Math.round((wonCount / dealCount) * 100) : 0,
    overall: leadCount ? Math.round((wonCount / leadCount) * 100) : 0,
  };
}

exports.getDeals = async (req, res) => {
  try {
    const deletedOnly =
      req.query.deleted_only === "true" || req.query.deleted_only === true;
    const clientIdFilter = String(req.query.client_id || req.query.clientId || "").trim();

    const filter = deletedOnly
      ? { is_deleted: true }
      : { is_deleted: { $ne: true } };
    if (clientIdFilter) {
      if (!mongoose.Types.ObjectId.isValid(clientIdFilter)) {
        return res.status(400).json({ message: "Invalid client id" });
      }
      filter.client_id = new mongoose.Types.ObjectId(clientIdFilter);
    }

    const accessFilter = await buildDealAccessFilter(req.user, filter);
    let dealsQuery = Deal.find(accessFilter).sort({ updatedAt: -1 });

    const limitParam = Number(req.query.limit);
    if (!Number.isNaN(limitParam) && limitParam > 0) {
      dealsQuery = dealsQuery.limit(limitParam);
    }

    const deals = await dealsQuery.lean();
    const dealIds = deals.map((deal) => deal._id).filter(Boolean);
    const dealIdStrings = dealIds.map((id) => id.toString());

    const leadIds = deals
      .map((deal) => deal.lead_id)
      .filter(Boolean)
      .map((id) => id.toString());

    const uniqueLeadIds = [...new Set(leadIds)];
    const clientIds = deals
      .map((deal) => deal.client_id)
      .filter(Boolean)
      .map((id) => id.toString());
    const uniqueClientIds = [...new Set(clientIds)];
    const [{ nextMap: nextByDealId, lastMap: lastByDealId }, { nextMap: nextByLeadId, lastMap: lastByLeadId }] =
      await Promise.all([
        fetchFollowupInsightsByField("dealId", dealIdStrings),
        fetchFollowupInsightsByField("leadId", uniqueLeadIds),
      ]);

    const leads = uniqueLeadIds.length
      ? await Leads.find({ _id: { $in: uniqueLeadIds } }).lean()
      : [];
    const contacts = uniqueLeadIds.length
      ? await LeadContacts.find({ lead_id: { $in: uniqueLeadIds } })
        .sort({ is_primary: -1, created_at: 1 })
        .lean()
      : [];
    const clients = uniqueClientIds.length
      ? await Client.find({ _id: { $in: uniqueClientIds } }).lean()
      : [];
    const clientContacts = uniqueClientIds.length
      ? await ClientContact.find({
        client_id: { $in: uniqueClientIds },
        is_active: true,
      }).lean()
      : [];

    const leadMap = new Map(leads.map((lead) => [lead._id.toString(), lead]));
    const clientMap = new Map(clients.map((client) => [client._id.toString(), client]));
    const contactMap = new Map();
    const clientContactMap = new Map();

    for (const contact of contacts) {
      const leadId = contact.lead_id?.toString();
      if (!leadId || contactMap.has(leadId)) continue;
      contactMap.set(leadId, {
        name: contact.name || "",
        phone: typeof contact.phone === 'string' && contact.phone ? contact.phone.split(',')[0].trim() : (Array.isArray(contact.phone) ? contact.phone[0] : ""),
        email: typeof contact.email === 'string' && contact.email ? contact.email.split(',')[0].trim() : (Array.isArray(contact.email) ? contact.email[0] : ""),
      });
    }
    for (const contact of clientContacts) {
      const clientId = (contact.client_id || "").toString();
      if (!clientId || clientContactMap.has(clientId)) continue;
      clientContactMap.set(clientId, {
        name: contact.name || "",
        phone: typeof contact.phone === 'string' && contact.phone ? contact.phone.split(',')[0].trim() : (Array.isArray(contact.phone) ? contact.phone[0] : ""),
        email: typeof contact.email === 'string' && contact.email ? contact.email.split(',')[0].trim() : (Array.isArray(contact.email) ? contact.email[0] : ""),
      });
    }

    const response = deals.map((deal) => {
      const leadId = deal.lead_id?.toString();
      const clientId = deal.client_id?.toString();
      const lead = leadId ? leadMap.get(leadId) : null;
      const client = clientId ? clientMap.get(clientId) : null;
      const temperatureData = mapTemperatureFromLead(lead);

      return {
        _id: deal._id,
        deal_id: deal._id,
        deal_name: deal.deal_name || "",
        client_id: deal.client_id || null,
        clientId: deal.client_id || null,
        assignedTo: deal.assignedTo || lead?.assigned_to || null,
        assigned_to: deal.assignedTo || lead?.assigned_to || null,
        company_name: getCompanyName(deal, lead, client),
        industry: lead?.industry || "",
        deal_value_estimate:
          typeof deal.dealValue === "number"
            ? deal.dealValue
            : lead?.deal_value_estimate || 0,
        ai_score: temperatureData.ai_score,
        lead_temperature: temperatureData.lead_temperature,
        last_contact_date: lead?.last_contact_date || deal.updatedAt || null,
        next_action: lead?.next_action || "",
        next_action_date: null,
        stage: deal.stage || "",
        converted_to_deal: true,
        primary_contact:
          (leadId ? contactMap.get(leadId) : null) ||
          (clientId ? clientContactMap.get(clientId) : null) ||
          null,
        lead_id: deal.lead_id || null,
        is_deleted: deal.is_deleted || false,
        deleted: deal.is_deleted || false,
        delete_reason: deal.deleted_reason || "",
        isActive: deal.isActive !== false,
      };
    });

    if (!deletedOnly && deals.length) {
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const sixMonthsAhead = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      const now = new Date();
      const toDeactivateDealIds = [];

      for (const deal of deals) {
        if (deal.is_deleted === true || deal.isActive === false) continue;
        if (["P6", "P7"].includes(String(deal.stage || "").toUpperCase())) continue;

        const dealId = String(deal._id || "");
        const leadId = deal.lead_id ? String(deal.lead_id) : "";
        const relatedLead = leadId ? leadMap.get(leadId) : null;

        const nextDealFollowup = nextByDealId.get(dealId);
        const nextLeadFollowup = leadId ? nextByLeadId.get(leadId) : null;
        const nextFollowupDate =
          toValidDate(nextDealFollowup?.dueDateTime) ||
          toValidDate(nextLeadFollowup?.dueDateTime);
        const hasFutureAction = nextFollowupDate && nextFollowupDate > now && nextFollowupDate <= sixMonthsAhead;
        if (hasFutureAction) continue;

        const latestActivityDate = [
          toValidDate(lastByDealId.get(dealId)),
          leadId ? toValidDate(lastByLeadId.get(leadId)) : null,
          toValidDate(relatedLead?.last_contact_date),
          toValidDate(deal.updatedAt),
        ]
          .filter(Boolean)
          .sort((a, b) => b - a)[0];

        if (latestActivityDate && latestActivityDate <= threeMonthsAgo) {
          toDeactivateDealIds.push(deal._id);
        }
      }

      if (toDeactivateDealIds.length) {
        const deactivatedIdSet = new Set(toDeactivateDealIds.map((id) => String(id)));
        await Deal.updateMany(
          { _id: { $in: toDeactivateDealIds }, is_deleted: { $ne: true } },
          { $set: { isActive: false } }
        );
        for (const row of response) {
          if (deactivatedIdSet.has(String(row._id))) {
            row.isActive = false;
          }
        }
      }
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSalesReportKpis = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const ranges = getSalesReportRanges(req.query, new Date());
    const assigneeScope = await resolveSalesAssigneeScope(req.query?.assignedTo);
    const viewerScope = await getManagerTeamScopeFilters(req.user);
    const baseFilter = await buildDealAggregateAccessFilter(req.user, {
      is_deleted: { $ne: true },
      ...assigneeScope.dealFilter,
    });
    const accessFilter = mergeMongoFilters(baseFilter, viewerScope.dealFilter);

    const [
      currentRevenueStats,
      previousRevenueStats,
      currentClosedStats,
      previousClosedStats,
      currentCycleStats,
      previousCycleStats,
    ] = await Promise.all([
      aggregateWonRevenue(accessFilter, ranges.currentStart, ranges.currentEnd),
      aggregateWonRevenue(accessFilter, ranges.previousStart, ranges.previousEnd),
      aggregateClosedDealStats(accessFilter, ranges.currentStart, ranges.currentEnd),
      aggregateClosedDealStats(accessFilter, ranges.previousStart, ranges.previousEnd),
      aggregateSalesCycle(accessFilter, ranges.currentStart, ranges.currentEnd),
      aggregateSalesCycle(accessFilter, ranges.previousStart, ranges.previousEnd),
    ]);

    const currentWinRate = currentClosedStats.closedDeals
      ? (currentClosedStats.wonDeals / currentClosedStats.closedDeals) * 100
      : 0;
    const previousWinRate = previousClosedStats.closedDeals
      ? (previousClosedStats.wonDeals / previousClosedStats.closedDeals) * 100
      : 0;

    const currentAvgDealSize = currentRevenueStats.wonDeals
      ? currentRevenueStats.revenue / currentRevenueStats.wonDeals
      : 0;
    const previousAvgDealSize = previousRevenueStats.wonDeals
      ? previousRevenueStats.revenue / previousRevenueStats.wonDeals
      : 0;

    const revenueGrowth = calculateGrowthPercentage(
      currentRevenueStats.revenue,
      previousRevenueStats.revenue
    );

    return res.json({
      period: ranges.period,
      comparisonLabel: ranges.comparisonLabel,
      ranges: {
        current: {
          start: ranges.currentStart,
          end: ranges.currentEnd,
        },
        previous: {
          start: ranges.previousStart,
          end: ranges.previousEnd,
        },
      },
      kpis: {
        revenue: {
          value: currentRevenueStats.revenue,
          previousValue: previousRevenueStats.revenue,
          growthPct: revenueGrowth,
        },
        winRate: {
          value: roundMetric(currentWinRate),
          previousValue: roundMetric(previousWinRate),
          growthPct: calculateGrowthPercentage(currentWinRate, previousWinRate),
          wonDeals: currentClosedStats.wonDeals,
          lostDeals: currentClosedStats.lostDeals,
          closedDeals: currentClosedStats.closedDeals,
          previousWonDeals: previousClosedStats.wonDeals,
          previousLostDeals: previousClosedStats.lostDeals,
          previousClosedDeals: previousClosedStats.closedDeals,
        },
        avgDealSize: {
          value: currentAvgDealSize,
          previousValue: previousAvgDealSize,
          growthPct: calculateGrowthPercentage(currentAvgDealSize, previousAvgDealSize),
          wonDeals: currentRevenueStats.wonDeals,
          previousWonDeals: previousRevenueStats.wonDeals,
        },
        salesCycle: {
          value: roundMetric(currentCycleStats.avgDays),
          previousValue: roundMetric(previousCycleStats.avgDays),
          growthPct: calculateGrowthPercentage(
            currentCycleStats.avgDays,
            previousCycleStats.avgDays
          ),
          sampleSize: currentCycleStats.sampleSize,
          previousSampleSize: previousCycleStats.sampleSize,
        },
        growth: {
          value: revenueGrowth,
          currentRevenue: currentRevenueStats.revenue,
          previousRevenue: previousRevenueStats.revenue,
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load sales report KPIs" });
  }
};

// fallback handlers used by routes
exports.getDealById = async (req, res) => {
  try {
    const includeDeleted =
      req.query.include_deleted === "true" || req.query.include_deleted === true;

    const filter = { _id: req.params.id };
    if (!includeDeleted) {
      filter.is_deleted = { $ne: true };
    }

    const accessFilter = await buildDealAccessFilter(req.user, filter);
    const deal = await Deal.findOne(accessFilter).lean();
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // Look up the associated lead and client to enrich the response
    const lead = deal.lead_id
      ? await Leads.findById(deal.lead_id).lean()
      : null;
    const client = deal.client_id
      ? await Client.findById(deal.client_id).lean()
      : null;

    // Load contacts from the lead
    const contacts = deal.lead_id
      ? await LeadContacts.find({ lead_id: deal.lead_id })
        .sort({ is_primary: -1, created_at: 1 })
        .lean()
      : [];

    // Load contacts from the client if no lead contacts
    const clientContacts =
      !contacts.length && deal.client_id
        ? await ClientContact.find({
          client_id: deal.client_id,
          is_active: true,
        }).lean()
        : [];
    const dealFollowups = await Followup.find({
      dealId: deal._id,
      is_deleted: false,
    })
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();
    const contactHistoryFromFollowups = dealFollowups.map((f) => ({
      followup_id: f._id,
      contacted_at:
        f.lastContactDate ||
        f.completedAt ||
        f.dueDateTime ||
        f.createdAt ||
        null,
      mode: f.actionType || "other",
      reply: "",
      notes: f.notes || "",
      next_action: f.title || "",
      next_action_date: f.dueDateTime || null,
      is_completed: f.status === "completed",
      completed_at: f.completedAt || null,
      status: f.status || "pending",
    }));

    // Build enriched response matching LeadFormPage field names
    const enriched = {
      ...deal,
      deal_name: deal.deal_name || "",
      company_name:
        getCompanyName(deal, lead, client),
      industry: lead?.industry || "",
      employee_count: lead?.employee_count || null,
      turnover_range: lead?.turnover_range || "",
      Address: lead?.Address || client?.Address || "",
      website: lead?.website || client?.website || "",
      source: lead?.source || client?.source || "",
      referred_by_user: lead?.referred_by_user || "",
      expo_event_id: lead?.expo_event_id || "",
      deal_value_estimate:
        typeof deal.dealValue === "number"
          ? deal.dealValue
          : lead?.deal_value_estimate || 0,
      assigned_to: deal.assignedTo || lead?.assigned_to || "",
      lead_temperature: lead?.lead_temperature || "",
      stage: deal.stage || "",
      last_contact_date: lead?.last_contact_date || deal.updatedAt || null,
      next_action:
        dealFollowups.find((f) => ["pending", "overdue"].includes(String(f.status || "").toLowerCase()))?.title ||
        lead?.next_action ||
        "",
      next_action_date:
        dealFollowups.find((f) => ["pending", "overdue"].includes(String(f.status || "").toLowerCase()))?.dueDateTime ||
        null,
      contact_history: contactHistoryFromFollowups,
      followup_count: dealFollowups.length,
      converted_to_deal: true,
    };

    // Add location fields if the lead has them
    if (lead?.location) {
      const Location = require("../models/location");
      const location = await Location.findById(lead.location).lean();
      if (location) {
        enriched.country = location.country || "";
        enriched.State = location.State || "";
        enriched.city = location.city || "";
        enriched.zone = location.zone || "";
      }
    }

    const allContacts = contacts.length
      ? contacts
      : clientContacts.map((cc) => ({
        name: cc.name || "",
        designation: cc.designation || "",
        phone: typeof cc.phone === 'string' && cc.phone ? cc.phone.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(cc.phone) ? cc.phone : []),
        email: typeof cc.email === 'string' && cc.email ? cc.email.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(cc.email) ? cc.email : []),
        linkedin: cc.linkedin || "",
        address: "",
        is_primary: true,
      }));

    res.json({ deal: enriched, contacts: allContacts, followups: dealFollowups });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch deal" });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    const update = { ...(req.body || {}) };
    delete update._id;

    const accessFilter = await buildDealAccessFilter(req.user, {
      _id: req.params.id,
      is_deleted: { $ne: true },
    });

    const existingDeal = await Deal.findOne(accessFilter).lean();
    if (!existingDeal) {
      return res.status(404).json({ message: "Deal not found" });
    }

    if (userRole !== "admin" && userRole !== "manager") {
      delete update.assignedTo;
      delete update.assigned_to;
    }

    const requestedAssignee = update.assignedTo || update.assigned_to;
    if (requestedAssignee && (await isAdminAssignee(requestedAssignee))) {
      return res.status(400).json({ message: "Deal cannot be assigned to an admin user" });
    }

    const dealUpdate = {};

    if (Object.prototype.hasOwnProperty.call(update, "assigned_to") || Object.prototype.hasOwnProperty.call(update, "assignedTo")) {
      const assignedTo = update.assignedTo || update.assigned_to || null;
      dealUpdate.assignedTo = assignedTo === "" ? null : assignedTo;
    }
    if (Object.prototype.hasOwnProperty.call(update, "deal_name") || Object.prototype.hasOwnProperty.call(update, "dealName")) {
      dealUpdate.deal_name = String(update.deal_name || update.dealName || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(update, "stage")) {
      const stage = String(update.stage || "P1").trim().toUpperCase();
      if (["P1", "P2", "P3", "P6", "P7"].includes(stage)) {
        dealUpdate.stage = stage;
        if (stage === "P7" || stage === "P6") {
          dealUpdate.isActive = false;
          if (!existingDeal.actualCloseDate) dealUpdate.actualCloseDate = new Date();
        } else {
          dealUpdate.isActive = true;
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "deal_value_estimate") || Object.prototype.hasOwnProperty.call(update, "dealValue")) {
      const amount = Number(update.dealValue ?? update.deal_value_estimate);
      dealUpdate.dealValue = Number.isFinite(amount) ? amount : 0;
    }
    if (Object.prototype.hasOwnProperty.call(update, "probability")) {
      const probability = Number(update.probability);
      if (Number.isFinite(probability)) {
        dealUpdate.probability = probability;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "expectedCloseDate")) {
      dealUpdate.expectedCloseDate = update.expectedCloseDate || null;
    }
    if (Object.prototype.hasOwnProperty.call(update, "actualCloseDate")) {
      dealUpdate.actualCloseDate = update.actualCloseDate || null;
    }
    if (Object.prototype.hasOwnProperty.call(update, "isActive") || Object.prototype.hasOwnProperty.call(update, "is_active")) {
      dealUpdate.isActive =
        update.isActive === true ||
        update.isActive === "true" ||
        update.is_active === true ||
        update.is_active === "true";
    }

    const leadUpdate = buildLeadUpdatePayload(update);
    if (dealUpdate.assignedTo !== undefined) {
      leadUpdate.assigned_to = dealUpdate.assignedTo;
    }

    const locationId = await resolveLocationId(update);
    if (locationId && existingDeal.lead_id) {
      leadUpdate.location = locationId;
    }

    let deal = existingDeal;
    if (Object.keys(dealUpdate).length) {
      deal = await Deal.findOneAndUpdate(
        accessFilter,
        { $set: dealUpdate },
        { returnDocument: "after" }
      ).lean();
    }

    if (existingDeal.lead_id && Object.keys(leadUpdate).length) {
      await Leads.findByIdAndUpdate(existingDeal.lead_id, { $set: leadUpdate });
    }

    if (existingDeal.lead_id && Array.isArray(update.contacts)) {
      await LeadContacts.deleteMany({ lead_id: existingDeal.lead_id });
      const contacts = normalizeContactRows(update.contacts);
      if (contacts.length) {
        await LeadContacts.insertMany(
          contacts.map((contact) => ({ ...contact, lead_id: existingDeal.lead_id }))
        );
      }
    }

    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update deal" });
  }
};

exports.deleteDeal = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can delete deals" });
    }

    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Delete reason is required" });
    }

    const deal = await Deal.findById(req.params.id);
    if (!deal || deal.is_deleted) {
      return res.status(404).json({ message: "Deal not found" });
    }

    deal.is_deleted = true;
    deal.deleted_reason = reason;
    deal.deleted_at = new Date();
    deal.isActive = false;

    await deal.save();
    return res.json({ message: "Deal deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to delete deal" });
  }
};

exports.restoreDeal = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can restore deals" });
    }

    const deal = await Deal.findById(req.params.id);
    if (!deal) {
      return res.status(404).json({ message: "Deal not found" });
    }

    deal.is_deleted = false;
    deal.isActive = true;
    deal.deleted_reason = "";
    deal.deleted_at = null;

    await deal.save();
    return res.json({ message: "Deal restored successfully", deal });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to restore deal" });
  }
};

exports.getSalesAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const ranges = getSalesReportRanges(req.query, now);
    const period = ranges.period;
    const assigneeScope = await resolveSalesAssigneeScope(req.query?.assignedTo);
    const viewerScope = await getManagerTeamScopeFilters(req.user);
    const shouldShowManagerTeamPerformance =
      getRoleName(req.user) === "admin" &&
      assigneeScope.selectedUser?._id &&
      assigneeScope.roleName === "manager";
    const managerTeamPerformanceScope = shouldShowManagerTeamPerformance
      ? await getTeamScopeFiltersForManagerId(assigneeScope.selectedUser._id)
      : null;
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const effectiveAnalyticsDealScope = shouldShowManagerTeamPerformance
      ? managerTeamPerformanceScope?.dealFilter || {}
      : assigneeScope.dealFilter;
    const effectiveAnalyticsLeadScope = shouldShowManagerTeamPerformance
      ? managerTeamPerformanceScope?.leadFilter || {}
      : assigneeScope.leadFilter;

    // trend chart: show only the selected timeline, not rolling history
    let trendStart, trendEnd, groupId, labelFn;
    if (period === "weekly") {
      trendStart = ranges.currentStart;
      trendEnd = ranges.currentEnd;
      groupId = {
        year: { $year: "$closedAt" },
        month: { $month: "$closedAt" },
        day: { $dayOfMonth: "$closedAt" },
      };
      labelFn = (r) => `${r._id.day} ${MONTHS[(r._id.month || 1) - 1]}`;
    } else if (period === "quarterly") {
      trendStart = ranges.currentStart;
      trendEnd = ranges.currentEnd;
      groupId = { year: { $year: "$closedAt" }, month: { $month: "$closedAt" } };
      labelFn = (r) => `${MONTHS[(r._id.month || 1) - 1]} ${r._id.year}`;
    } else if (period === "yearly") {
      trendStart = ranges.currentStart;
      trendEnd = ranges.currentEnd;
      groupId = { year: { $year: "$closedAt" }, month: { $month: "$closedAt" } };
      labelFn = (r) => `${MONTHS[(r._id.month || 1) - 1]}`;
    } else {
      trendStart = ranges.currentStart;
      trendEnd = ranges.currentEnd;
      groupId = {
        year: { $year: "$closedAt" },
        month: { $month: "$closedAt" },
        day: { $dayOfMonth: "$closedAt" },
      };
      labelFn = (r) => `${r._id.day} ${MONTHS[(r._id.month || 1) - 1]}`;
    }

    const wonFilter = await buildDealAggregateAccessFilter(req.user, {
      is_deleted: { $ne: true },
      stage: DEAL_WON_STAGE,
      ...effectiveAnalyticsDealScope,
    });
    const scopedWonFilter = mergeMongoFilters(wonFilter, viewerScope.dealFilter);

    const addClosedAt = { $addFields: { closedAt: { $ifNull: ["$actualCloseDate", "$updatedAt"] } } };
    const periodMatch = { $match: { closedAt: { $gte: trendStart, $lt: trendEnd } } };
    const kpiPeriodMatch = { $match: { closedAt: { $gte: ranges.currentStart, $lt: ranges.currentEnd } } };

    const [revenueTrend, revenueByUser] = await Promise.all([
      Deal.aggregate([
        { $match: scopedWonFilter },
        addClosedAt,
        periodMatch,
        { $group: { _id: groupId, total: { $sum: { $ifNull: ["$dealValue", 0] } } } },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1, "_id.block": 1 } },
      ]),
      Deal.aggregate([
        { $match: scopedWonFilter },
        addClosedAt,
        kpiPeriodMatch,
        { $group: { _id: "$assignedTo", total: { $sum: { $ifNull: ["$dealValue", 0] } } } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const periodFilter = {
      is_deleted: { $ne: true },
      createdAt: { $gte: ranges.currentStart, $lt: ranges.currentEnd },
      ...viewerScope.dealFilter,
      ...effectiveAnalyticsDealScope,
    };
    const assignedPerformanceFilter = shouldShowManagerTeamPerformance
      ? mergeMongoFilters(
          { is_deleted: { $ne: true }, createdAt: { $gte: ranges.currentStart, $lt: ranges.currentEnd } },
          viewerScope.dealFilter,
          managerTeamPerformanceScope?.dealFilter
        )
      : periodFilter;
    const closedPerformanceFilter = shouldShowManagerTeamPerformance
      ? mergeMongoFilters(
          { is_deleted: { $ne: true } },
          viewerScope.dealFilter,
          managerTeamPerformanceScope?.dealFilter
        )
      : mergeMongoFilters(
          { is_deleted: { $ne: true } },
          viewerScope.dealFilter,
          assigneeScope.dealFilter
        );
    const performanceWonFilter = shouldShowManagerTeamPerformance
      ? mergeMongoFilters(
          { is_deleted: { $ne: true }, stage: DEAL_WON_STAGE },
          viewerScope.dealFilter,
          managerTeamPerformanceScope?.dealFilter
        )
      : scopedWonFilter;

    const targetSummary =
      assigneeScope.selectedUser &&
      !assigneeScope.isManagerScope &&
      assigneeScope.roleName !== "manager"
        ? await getSalesTargetSummary(
            assigneeScope.selectedUser._id,
            period,
            ranges.currentStart,
            ranges.currentEnd
          )
        : null;

    let teamTargetDoc = null;
    let managerIdForTeam = null;

    if (getUserRoleName(req.user) === "manager" && (!assigneeScope.selectedUser || assigneeScope.selectedUser._id.toString() === req.user._id.toString())) {
        managerIdForTeam = req.user._id;
    } else if (shouldShowManagerTeamPerformance) {
        managerIdForTeam = assigneeScope.selectedUser._id;
    }

    if (managerIdForTeam) {
        const team = await Team.findOne({ "teamLeads.userId": managerIdForTeam }).select("_id").lean();
        if (team) {
            teamTargetDoc = await SalesTarget.findOne({
                scope_type: "team",
                team_id: team._id,
                status: { $ne: "archived" },
                    period_type: period,
                period_start: { $lte: ranges.currentEnd },
                period_end: { $gte: ranges.currentStart }
            }).sort({ updated_at: -1 }).lean();
        }
    }

    const [conversionSummary, wonPerfRows, totalPerfRows, assignedPerfRows, sizeRows, tableDealRows] = await Promise.all([
      aggregateLeadCohortConversion(
        mergeMongoFilters(viewerScope.leadFilter, effectiveAnalyticsLeadScope),
        ranges.currentStart,
        ranges.currentEnd
      ),
      // Revenue & won counts: filter by closedAt (same as KPI)
      Deal.aggregate([
        { $match: performanceWonFilter },
        addClosedAt,
        kpiPeriodMatch,
        { $group: { _id: "$assignedTo", wonDeals: { $sum: 1 }, revenue: { $sum: { $ifNull: ["$dealValue", 0] } } } },
      ]),
      // Closed deal counts: filter by closedAt so win rate stays on the same timeline basis
      Deal.aggregate([
        { $match: closedPerformanceFilter },
        addClosedAt,
        {
          $match: {
            stage: { $in: [DEAL_WON_STAGE, DEAL_LOST_STAGE] },
            closedAt: { $gte: ranges.currentStart, $lt: ranges.currentEnd },
          },
        },
        { $group: { _id: "$assignedTo", totalDeals: { $sum: 1 } } },
      ]),
      Deal.aggregate([
        { $match: assignedPerformanceFilter },
        { $group: { _id: "$assignedTo", assignedDeals: { $sum: 1 }, assignedRevenue: { $sum: { $ifNull: ["$dealValue", 0] } } } },
      ]),
      Deal.aggregate([
        { $match: periodFilter },
        { $addFields: { sizeLabel: { $switch: { branches: [{ case: { $lt: ["$dealValue", 50000] }, then: "Small (<₹50K)" }, { case: { $lt: ["$dealValue", 200000] }, then: "Medium (₹50K–₹2L)" }], default: "Large (>₹2L)" } } } },
        { $group: { _id: "$sizeLabel", count: { $sum: 1 } } },
      ]),
      Deal.find(periodFilter)
        .select("_id deal_name client_id lead_id assignedTo dealValue stage createdAt actualCloseDate isActive")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // merge won stats + total deal counts
    const totalMap = new Map(totalPerfRows.map((r) => [String(r._id), r.totalDeals]));
    const assignedMap = new Map(assignedPerfRows.map((r) => [String(r._id), { deals: r.assignedDeals, revenue: r.assignedRevenue }]));
    const userIdsRaw = [
      ...wonPerfRows.map((r) => String(r._id)),
      ...totalPerfRows.map((r) => String(r._id)),
      ...assignedPerfRows.map((r) => String(r._id))
    ];
    const userIds = [...new Set(userIdsRaw.filter((id) => id !== "undefined" && id !== "null"))];

    const activeTargets = await SalesTarget.find({
      user_id: { $in: userIds },
      $or: [{ scope_type: "user" }, { scope_type: { $exists: false } }],
      status: { $ne: "archived" },
      period_type: period,
      period_start: { $lte: ranges.currentEnd },
      period_end: { $gte: ranges.currentStart },
    }).lean();

    const userTargetMap = new Map();
    for (const doc of activeTargets) {
      const uid = String(doc.user_id);
      if (!userTargetMap.has(uid)) userTargetMap.set(uid, new Map());
      const mapForUser = userTargetMap.get(uid);
      const key = [
        String(doc.period_type || ""),
        new Date(doc.period_start).toISOString(),
        new Date(doc.period_end).toISOString(),
      ].join(":");
      if (!mapForUser.has(key)) {
        mapForUser.set(key, doc);
      }
    }

    const aggregatedUserTargets = new Map();
    for (const [uid, mapForUser] of userTargetMap.entries()) {
      let rev = 0;
      let deal = 0;
      for (const doc of mapForUser.values()) {
        rev += Number(doc.revenue_target || 0);
        deal += Number(doc.deal_target || 0);
      }
      aggregatedUserTargets.set(uid, { revenueTarget: rev, dealTarget: deal });
    }

    const perfUsers = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
    const userNameMap = new Map(perfUsers.map((u) => [String(u._id), u.name]));
    const tableLeadIds = [...new Set(
      (tableDealRows || [])
        .map((deal) => String(deal?.lead_id || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )].map((id) => new mongoose.Types.ObjectId(id));
    const tableClientIds = [...new Set(
      (tableDealRows || [])
        .map((deal) => String(deal?.client_id || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )].map((id) => new mongoose.Types.ObjectId(id));
    const tableAssignedIds = [...new Set(
      (tableDealRows || [])
        .map((deal) => String(deal?.assignedTo || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )].map((id) => new mongoose.Types.ObjectId(id));
    const [tableLeads, tableClients, tableAssignees] = await Promise.all([
      tableLeadIds.length ? Leads.find({ _id: { $in: tableLeadIds } }).select("company_name").lean() : [],
      tableClientIds.length ? Client.find({ _id: { $in: tableClientIds } }).select("name").lean() : [],
      tableAssignedIds.length ? User.find({ _id: { $in: tableAssignedIds } }).select("name email").lean() : [],
    ]);
    const tableLeadMap = new Map((tableLeads || []).map((lead) => [String(lead?._id || ""), lead]));
    const tableClientMap = new Map((tableClients || []).map((client) => [String(client?._id || ""), client]));
    const tableAssigneeMap = new Map((tableAssignees || []).map((user) => [String(user?._id || ""), user]));
    
    const perfRows = userIds
      .map((uid) => {
        const wonRow = wonPerfRows.find((r) => String(r._id) === uid) || { revenue: 0, wonDeals: 0 };
        const totalDeals = totalMap.get(uid) || wonRow.wonDeals;
        const assignedStats = assignedMap.get(uid) || { deals: 0, revenue: 0 };
        const t = aggregatedUserTargets.get(uid) || { revenueTarget: 0, dealTarget: 0 };

        return {
          name: userNameMap.get(uid) || "Unassigned",
          revenue: wonRow.revenue,
          wonDeals: wonRow.wonDeals,
          totalDeals: totalDeals,
          assignedDeals: assignedStats.deals,
          assignedRevenue: assignedStats.revenue,
          targetRevenue: t.revenueTarget,
          targetDeals: t.dealTarget,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    const salesTableRows = (tableDealRows || []).map((deal) => {
      const lead = tableLeadMap.get(String(deal?.lead_id || "")) || null;
      const client = tableClientMap.get(String(deal?.client_id || "")) || null;
      const assignee = tableAssigneeMap.get(String(deal?.assignedTo || "")) || null;

      return {
        id: String(deal?._id || ""),
        dealName: deal?.deal_name || "Unnamed Deal",
        companyName: getCompanyName(deal, lead, client) || "Unknown Company",
        createdAt: deal?.createdAt || null,
        closedAt: deal?.actualCloseDate || null,
        dealValue: Number(deal?.dealValue || 0),
        stage: String(deal?.stage || ""),
        assignedToName: assignee?.name || assignee?.email || "Unassigned",
        isActive: deal?.isActive !== false,
      };
    });

    res.json({
      revenueTrend: revenueTrend.map((row) => ({ label: labelFn(row), total: row.total })),
      revenueByUser: revenueByUser.map((row) => ({ name: row.user?.name || "Unassigned", total: row.total })),
      conversion: conversionSummary,
      targetSummary,
      teamTarget: teamTargetDoc ? {
        revenueTarget: teamTargetDoc.revenue_target || 0,
        dealTarget: teamTargetDoc.deal_target || 0,
      } : null,
      performanceByUser: perfRows.map((r) => ({
        name: r.name,
        targetRevenue: r.targetRevenue,
        revenue: r.revenue,
        assignedRevenue: r.assignedRevenue,
        assignedDeals: r.assignedDeals,
        targetDeals: r.targetDeals,
        wonDeals: r.wonDeals,
        totalDeals: r.totalDeals,
        winRate: r.totalDeals ? Math.round((r.wonDeals / r.totalDeals) * 100) : 0,
      })),
      dealSizeBuckets: sizeRows.map((r) => ({ label: r._id, count: r.count })),
      tableRows: salesTableRows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load sales analytics" });
  }
};

exports.getClientSuggestions = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
    const allowedIds = await getAccessibleUserIds(req.user);
    const assignedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));

    const dealClientIds = await Deal.find({
      is_deleted: { $ne: true },
      assignedTo: { $in: assignedObjectIds },
      client_id: { $exists: true, $ne: null },
    }).distinct("client_id");

    const filter = {
      is_deleted: { $ne: true },
      _id: { $in: dealClientIds },
    };
    if (q) {
      filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const clients = await Client.find(filter)
      .select("_id name")
      .sort({ name: 1 })
      .limit(limit);

    res.json(
      clients.map((c) => ({
        _id: c._id,
        name: c.name || "",
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch client suggestions" });
  }
};
