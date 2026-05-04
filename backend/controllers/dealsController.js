const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const User = require("../models/users");
const Followup = require("../models/followUp");
const Location = require("../models/location");

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
  const validContacts = contacts.filter((contact) => contact && (contact.name || contact.phone || contact.email));
  const hasPrimary = validContacts.some((contact) => contact.is_primary === true || contact.is_primary === "true");

  return validContacts.map((contact, index) => ({
    name: contact.name || "",
    designation: contact.designation || "",
    phone: contact.phone || "",
    email: contact.email || "",
    linkedin: contact.linkedin || "",
    address: contact.address || "",
    is_primary: hasPrimary
      ? (contact.is_primary === true || contact.is_primary === "true")
      : index === 0,
  }));
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
        phone: contact.phone || "",
        email: contact.email || "",
      });
    }
    for (const contact of clientContacts) {
      const clientId = (contact.client_id || "").toString();
      if (!clientId || clientContactMap.has(clientId)) continue;
      clientContactMap.set(clientId, {
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
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
        status: deal.status || "open",
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
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDeactivateDealIds = [];

      for (const deal of deals) {
        if (deal.is_deleted === true || deal.isActive === false) continue;

        const dealId = String(deal._id || "");
        const leadId = deal.lead_id ? String(deal.lead_id) : "";
        const relatedLead = leadId ? leadMap.get(leadId) : null;

        const hasNextFollowup = Boolean(
          nextByDealId.get(dealId) ||
          (leadId && nextByLeadId.get(leadId)) ||
          toValidDate(relatedLead?.next_action_date)
        );
        if (hasNextFollowup) continue;

        const latestActivityDate = [
          toValidDate(lastByDealId.get(dealId)),
          leadId ? toValidDate(lastByLeadId.get(leadId)) : null,
          toValidDate(relatedLead?.last_contact_date),
          toValidDate(deal.updatedAt),
        ]
          .filter(Boolean)
          .sort((a, b) => b - a)[0];

        if (latestActivityDate && latestActivityDate <= cutoffDate) {
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
      status: deal.status || "open",
      stage: deal.stage || "",
      last_contact_date: lead?.last_contact_date || deal.updatedAt || null,
      next_action: lead?.next_action || "",
      contact_history: [],
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
        phone: cc.phone || "",
        email: cc.email || "",
        linkedin: cc.linkedin || "",
        address: "",
        is_primary: true,
      }));

    res.json({ deal: enriched, contacts: allContacts });
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
      if (["P1", "P2", "P3", "P4", "P5", "P6", "P7"].includes(stage)) {
        dealUpdate.stage = stage;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "deal_value_estimate") || Object.prototype.hasOwnProperty.call(update, "dealValue")) {
      const amount = Number(update.dealValue ?? update.deal_value_estimate);
      dealUpdate.dealValue = Number.isFinite(amount) ? amount : 0;
    }
    if (Object.prototype.hasOwnProperty.call(update, "status")) {
      const status = String(update.status || "open").trim().toLowerCase();
      if (["open", "won", "lost"].includes(status)) {
        dealUpdate.status = status;
      }
    }
    if (dealUpdate.stage === "P7") {
      dealUpdate.status = "won";
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
      deal = await Deal.findOneAndUpdate(accessFilter, { $set: dealUpdate }, { returnDocument: "after" }).lean();
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
