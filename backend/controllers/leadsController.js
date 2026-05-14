const mongoose = require("mongoose");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Location = require("../models/location");
const Followup = require("../models/followUp");
const Deal = require("../models/deals");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const Industry = require("../models/industries");
const User = require("../models/users");
const Source = require("../models/sources");
const Event = require("../models/events");
const DealStageHistory = require("../models/dealStageHistory");
const Notification = require("../models/notifications");
const { processPendingNotificationEmails } = require("../services/notificationEmailWorker");
const { normalizePhone } = require("../utils/phoneUtils");
let legacyLeadFlagsNormalized = false;
let legacyLeadFlagsNormalizationPromise = null;
const INACTIVE_LEAD_STAGES = new Set(["P4", "P6", "P7"]);

function getRoleName(user = {}) {
  return String(user?.role || "").trim().toLowerCase();
}

function isPrivilegedUser(user = {}) {
  const roleName = getRoleName(user);
  return roleName === "admin" || roleName === "manager";
}

function normalizeContactValues(value) {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => String(item || "").split(/\s*(?:\||,|;|\n)\s*/))
    : String(value || "").split(/\s*(?:\||,|;|\n)\s*/);

  return rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => {
      const normalized = item.toLowerCase();
      return normalized && normalized !== "unreadable" && normalized !== "undefined" && normalized !== "null";
    });
}

function normalizeContacts(contacts = []) {
  if (!Array.isArray(contacts)) return [];

  const validContacts = contacts.filter((contact) => contact && (contact.name || (contact.phone && contact.phone.length) || (contact.email && contact.email.length)));
  const hasPrimary = validContacts.some(contact => contact.is_primary === true || contact.is_primary === "true");

  return validContacts.map((contact, index) => {
    const phoneArr = normalizeContactValues(contact.phone);
    const emailArr = normalizeContactValues(contact.email);
    return {
      name: contact.name || "",
      designation: contact.designation || "",
      phone: phoneArr.map((p) => normalizePhone(p)).filter(Boolean).join(", "),
      email: emailArr.join(", "),
      linkedin: contact.linkedin || "",
      address: contact.address || "",
      is_primary: hasPrimary ? (contact.is_primary === true || contact.is_primary === "true") : (index === 0),
    };
  });
}

async function resolveLocationId(payload) {
  const locationPayload = {
    country: payload.country,
    State: payload.State,
    city: payload.city,
    zone: payload.zone,
  };

  const hasAnyLocation = Object.values(locationPayload).some(
    (value) => typeof value === "string" && value.trim() !== ""
  );

  if (!hasAnyLocation) return null;

  const normalized = {
    country: (locationPayload.country || "").trim(),
    State: (locationPayload.State || "").trim(),
    city: (locationPayload.city || "").trim(),
    zone: (locationPayload.zone || "").trim(),
  };

  let location = await Location.findOne(normalized);
  if (!location) {
    location = await Location.create(normalized);
  }

  return location._id;
}

function stripLeadPayloadFields(payload) {
  const cleaned = { ...payload };
  delete cleaned._id;
  delete cleaned.contacts;
  delete cleaned.country;
  delete cleaned.State;
  delete cleaned.city;
  delete cleaned.zone;
  delete cleaned.contact_history;
  delete cleaned.next_action_date;
  delete cleaned.ai_score;
  delete cleaned.status;

  if (cleaned.is_existing_company !== undefined && cleaned.is_existing_client === undefined) {
    cleaned.is_existing_client = cleaned.is_existing_company;
  }
  if (cleaned.is_existing_client !== undefined) {
    cleaned.is_existing_client =
      cleaned.is_existing_client === true ||
      cleaned.is_existing_client === "true" ||
      cleaned.is_existing_client === "Yes";
  }
  if (cleaned.converted_to_deal !== undefined) {
    cleaned.converted_to_deal =
      cleaned.converted_to_deal === true ||
      cleaned.converted_to_deal === "true" ||
      cleaned.converted_to_deal === "Yes";
  }
  if (!cleaned.assigned_to) {
    delete cleaned.assigned_to;
  }
  delete cleaned.is_existing_company;
  return cleaned;
}

function applyLeadDerivations(payload) {
  const normalized = { ...payload };

  if (normalized.deal_value_estimate !== undefined && normalized.deal_value_estimate !== "") {
    const amount = Number(normalized.deal_value_estimate);
    if (!Number.isNaN(amount)) {
      normalized.deal_value_estimate = amount;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, "stage")) {
    const stage = String(normalized.stage || "").trim().toUpperCase();
    if (["P1", "P2", "P3", "P4", "P5", "P6", "P7"].includes(stage)) {
      normalized.stage = stage;
      normalized.is_active = !INACTIVE_LEAD_STAGES.has(stage);
    }
  }

  return normalized;
}

async function fetchLeadFollowupMap(leadIds = []) {
  if (!leadIds.length) return new Map();

  const followups = await Followup.find({
    leadId: { $in: leadIds },
    is_deleted: false,
    status: { $in: ["pending", "overdue"] },
  })
    .sort({ dueDateTime: 1, createdAt: -1 })
    .select("leadId title dueDateTime status")
    .lean();

  const map = new Map();
  for (const followup of followups) {
    const leadId = followup.leadId?.toString();
    if (!leadId || map.has(leadId)) continue;
    map.set(leadId, followup);
  }
  return map;
}

async function fetchLeadFollowupInsights(leadIds = []) {
  if (!leadIds.length) {
    return { nextFollowupMap: new Map(), lastActivityMap: new Map() };
  }

  const followups = await Followup.find({
    leadId: { $in: leadIds },
    is_deleted: false,
  })
    .select("leadId status dueDateTime lastContactDate completedAt createdAt")
    .lean();

  const nextFollowupMap = new Map();
  const lastActivityMap = new Map();

  for (const followup of followups) {
    const leadId = followup.leadId?.toString();
    if (!leadId) continue;

    if (["pending", "overdue"].includes(String(followup.status || "").toLowerCase())) {
      const existing = nextFollowupMap.get(leadId);
      const currentDue = toValidDate(followup.dueDateTime);
      const existingDue = toValidDate(existing?.dueDateTime);
      if (!existing || (currentDue && (!existingDue || currentDue < existingDue))) {
        nextFollowupMap.set(leadId, followup);
      }
    }

    const candidates = [
      toValidDate(followup.lastContactDate),
      toValidDate(followup.completedAt),
      toValidDate(followup.createdAt),
    ].filter(Boolean);
    if (!candidates.length) continue;
    const latestForFollowup = new Date(Math.max(...candidates.map((d) => d.getTime())));
    const previous = toValidDate(lastActivityMap.get(leadId));
    if (!previous || latestForFollowup > previous) {
      lastActivityMap.set(leadId, latestForFollowup);
    }
  }

  return { nextFollowupMap, lastActivityMap };
}

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSourceName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isReferenceLikeSource(sourceName) {
  const normalized = normalizeSourceName(sourceName);
  return /(ref|refer|reference|referr|reffe|refee)/.test(normalized);
}

function isEventExpoLikeSource(sourceName) {
  const normalized = normalizeSourceName(sourceName);
  return (
    (normalized.includes("event") && normalized.includes("expo")) ||
    normalized.includes("events n expos")
  );
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

async function applySourceDependentValidation(payload) {
  if (!payload?.source) return;

  if (payload.source === "OCR") {
    let ocrSource = await Source.findOne({ name: "OCR", is_deleted: false }).select("_id name").lean();
    if (!ocrSource) {
      const newSource = await Source.create({ name: "OCR", is_deleted: false });
      ocrSource = { _id: newSource._id, name: "OCR" };
    }
    payload.source = ocrSource._id;
  }

  const sourceDoc = await Source.findOne({
    _id: payload.source,
    is_deleted: false,
  })
    .select("_id name")
    .lean();

  if (!sourceDoc) {
    const err = new Error("Invalid source selected");
    err.statusCode = 400;
    throw err;
  }

  if (isReferenceLikeSource(sourceDoc.name)) {
    if (!payload.referred_by_user) {
      const err = new Error("Reference source requires selecting a referred user");
      err.statusCode = 400;
      throw err;
    }
    const referredUser = await User.findOne({
      _id: payload.referred_by_user,
      is_deleted: { $ne: true },
    })
      .select("_id")
      .lean();
    if (!referredUser) {
      const err = new Error("Invalid referred user selected");
      err.statusCode = 400;
      throw err;
    }
    payload.expo_event_id = null;
    return;
  }

  if (isEventExpoLikeSource(sourceDoc.name)) {
    if (!payload.expo_event_id) {
      const err = new Error("Event & Expo source requires selecting an event/expo");
      err.statusCode = 400;
      throw err;
    }
    const eventDoc = await Event.findOne({
      _id: payload.expo_event_id,
      is_deleted: false,
    })
      .select("_id")
      .lean();
    if (!eventDoc) {
      const err = new Error("Invalid event/expo selected");
      err.statusCode = 400;
      throw err;
    }
    payload.referred_by_user = null;
    return;
  }

  payload.referred_by_user = null;
  payload.expo_event_id = null;
}

async function resolveConversionActorId(lead, req) {
  if (req?.user?._id) return req.user._id;
  if (lead?.assigned_to) return lead.assigned_to;

  const fallback = await User.findOne({ is_deleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();
  return fallback?._id || null;
}

async function resolveIndustryId(leadIndustry) {
  const name = (leadIndustry || "").trim();
  const finalName = name || "General";

  const existing = await Industry.findOne({
    name: new RegExp(`^${escapeRegExp(finalName)}$`, "i"),
  })
    .select("_id")
    .lean();

  if (existing?._id) return existing._id;

  const created = await Industry.create({
    name: finalName,
    is_deleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return created._id;
}

function computeAiRiskScore(leadTemperature) {
  const temp = (leadTemperature || "").toLowerCase();
  if (temp === "hot") return 25;
  if (temp === "warm") return 50;
  return 70;
}

async function normalizeLegacyLeadFlagsOnce() {
  if (legacyLeadFlagsNormalized) return;
  if (legacyLeadFlagsNormalizationPromise) return legacyLeadFlagsNormalizationPromise;

  legacyLeadFlagsNormalizationPromise = (async () => {
    const col = Leads.collection;
    await Promise.all([
      col.updateMany(
        { is_deleted: { $in: ["Yes", "No"] } },
        [
          {
            $set: {
              is_deleted: { $eq: ["$is_deleted", "Yes"] },
            },
          },
        ]
      ),
      col.updateMany(
        { converted_to_deal: { $in: ["Yes", "No"] } },
        [
          {
            $set: {
              converted_to_deal: { $eq: ["$converted_to_deal", "Yes"] },
            },
          },
        ]
      ),
      col.updateMany(
        { is_existing_client: { $in: ["Yes", "No"] } },
        [
          {
            $set: {
              is_existing_client: { $eq: ["$is_existing_client", "Yes"] },
            },
          },
        ]
      ),
    ]);
    legacyLeadFlagsNormalized = true;
  })();

  return legacyLeadFlagsNormalizationPromise;
}

async function syncLeadFollowupsFromHistory(lead, history = []) {
  if (!lead?._id || !Array.isArray(history)) return;

  const assignedTo = lead.assigned_to || null;
  if (!assignedTo) return;

  const entries = history.filter(
    (entry) =>
      entry &&
      (entry.next_action || entry.notes || entry.reply || entry.mode || entry.contacted_at)
  );

  for (const entry of entries) {
    const followupId = entry.followup_id || entry._id || null;
    const dueDateTime =
      toValidDate(entry.next_action_date) ||
      toValidDate(entry.contacted_at) ||
      new Date();

    const payload = {
      leadId: lead._id,
      assignedTo,
      actionType: entry.mode || "other",
      title: entry.next_action || entry.reply || entry.notes || "Follow-up",
      dueDateTime,
      status:
        entry.is_completed === true || entry.is_completed === "true"
          ? "completed"
          : "pending",
      completedAt:
        entry.is_completed === true || entry.is_completed === "true"
          ? toValidDate(entry.completed_at) || new Date()
          : null,
      lastContactDate: toValidDate(entry.contacted_at) || null,
      nextActionDate: toValidDate(entry.next_action_date) || null,
      is_deleted: false,
    };

    if (followupId) {
      await Followup.findOneAndUpdate(
        { _id: followupId, leadId: lead._id },
        payload,
        { returnDocument: "after", upsert: false }
      );
    } else {
      await Followup.create(payload);
    }
  }
}

exports.searchCompany = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json([]);

    const regex = new RegExp(escapeRegExp(q), "i");

    // Search in leads (non-deleted)
    const matchingLeads = await Leads.find({
      company_name: regex,
      $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }],
    })
      .sort({ updated_at: -1 })
      .limit(10)
      .lean();

    // Search in clients
    const matchingClients = await Client.find({
      name: regex,
      is_deleted: { $ne: true },
    })
      .limit(10)
      .lean();

    // Deduplicate by company name (case insensitive)
    const seen = new Set();
    const results = [];

    for (const lead of matchingLeads) {
      const key = (lead.company_name || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let location = null;
      if (lead.location) {
        location = await Location.findById(lead.location).lean();
      }

      // Get lead contacts
      const leadContacts = await LeadContacts.find({ lead_id: lead._id })
        .sort({ is_primary: -1, created_at: 1 })
        .lean();

      results.push({
        _id: lead._id,
        type: "lead",
        company_name: lead.company_name || "",
        industry: lead.industry || "",
        employee_count: lead.employee_count || "",
        turnover_range: lead.turnover_range || "",
        Address: lead.Address || "",
        website: lead.website || "",
        source: lead.source || "",
        referred_by_user: lead.referred_by_user || "",
        expo_event_id: lead.expo_event_id || "",
        deal_value_estimate: lead.deal_value_estimate || "",
        lead_temperature: lead.lead_temperature || "cold",
        assigned_to: lead.assigned_to || "",
        country: location?.country || "",
        State: location?.State || "",
        city: location?.city || "",
        zone: location?.zone || "",
        contacts: leadContacts.map((c) => ({
          name: c.name || "",
          designation: c.designation || "",
          phone: typeof c.phone === 'string' && c.phone ? c.phone.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(c.phone) ? c.phone : []),
          email: typeof c.email === 'string' && c.email ? c.email.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(c.email) ? c.email : []),
          linkedin: c.linkedin || "",
          address: c.address || "",
          is_primary: Boolean(c.is_primary),
        })),
      });
    }

    for (const client of matchingClients) {
      const key = (client.name || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Resolve location
      let location = null;
      if (client.location) {
        location = await Location.findById(client.location).lean();
      }

      // Resolve industry name from ObjectId
      let industryName = "";
      if (client.industry) {
        const ind = await Industry.findById(client.industry).select("name").lean();
        industryName = ind?.name || "";
      }

      // Get client contacts
      const clientContacts = await ClientContact.find({
        client_id: String(client._id),
        is_active: true,
      }).lean();

      results.push({
        _id: client._id,
        type: "client",
        company_name: client.name || "",
        industry: industryName,
        employee_count: client.employeeCount || "",
        turnover_range: client.turnoverRange || "",
        Address: client.Address || "",
        website: client.website || "",
        source: client.source || "",
        deal_value_estimate: "",
        lead_temperature: "cold",
        assigned_to: "",
        country: location?.country || "",
        State: location?.State || "",
        city: location?.city || "",
        zone: location?.zone || "",
        contacts: clientContacts.map((c) => ({
          name: c.name || "",
          designation: c.designation || "",
          phone: typeof c.phone === 'string' && c.phone ? c.phone.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(c.phone) ? c.phone : []),
          email: typeof c.email === 'string' && c.email ? c.email.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(c.email) ? c.email : []),
          linkedin: c.linkedin || "",
          address: "",
          is_primary: true,
        })),
      });
    }

    res.json(results.slice(0, 10));
  } catch (err) {
    console.error("searchCompany error", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getLeads = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const deletedOnly =
      req.query.deleted_only === "true" || req.query.deleted_only === true;
    const includeConverted =
      req.query.include_converted === "true" || req.query.include_converted === true;
    const limit = Number(req.query.limit);

    const filter = deletedOnly
      ? { is_deleted: true }
      : includeConverted
        ? { $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }] }
        : {
          $and: [
            { $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }] },
            {
              $or: [
                { converted_to_deal: { $ne: true } },
                { is_active: false },
              ],
            },
          ],
        };

    if (!isPrivilegedUser(req.user)) {
      filter.assigned_to = req.user?._id || null;
    }

    let leadsQuery = Leads.find(filter).sort({ updated_at: -1 });
    if (!Number.isNaN(limit) && limit > 0) {
      leadsQuery = leadsQuery.limit(limit);
    }

    const leads = await leadsQuery.lean();
    const leadIds = leads.map((lead) => lead._id);
    const { nextFollowupMap, lastActivityMap } = await fetchLeadFollowupInsights(leadIds);
    const followupMap = await fetchLeadFollowupMap(leadIds);

    if (!deletedOnly && leads.length) {
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const sixMonthsAhead = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      const now = new Date();
      const toDeactivateLeadIds = [];

      for (const lead of leads) {
        if (lead.is_deleted === true || lead.is_active === false) continue;
        const leadId = String(lead._id || "");
        const nextFollowup = nextFollowupMap.get(leadId);
        const nextFollowupDate = toValidDate(nextFollowup?.dueDateTime);
        const hasFutureAction = nextFollowupDate && nextFollowupDate > now && nextFollowupDate <= sixMonthsAhead;
        if (hasFutureAction) continue;

        const latestActivityDate = [
          toValidDate(lead.last_contact_date),
          toValidDate(lastActivityMap.get(leadId)),
          toValidDate(lead.updated_at),
          toValidDate(lead.created_at),
        ]
          .filter(Boolean)
          .sort((a, b) => b - a)[0];

        if (latestActivityDate && latestActivityDate <= threeMonthsAgo) {
          toDeactivateLeadIds.push(lead._id);
          lead.is_active = false;
        }
      }

      if (toDeactivateLeadIds.length) {
        await Leads.updateMany(
          { _id: { $in: toDeactivateLeadIds }, is_deleted: { $ne: true } },
          { $set: { is_active: false } }
        );
      }
    }

    const locationIds = leads
      .map((lead) => lead.location)
      .filter(Boolean)
      .map((id) => id.toString());

    const uniqueLocationIds = [...new Set(locationIds)];
    const locations = uniqueLocationIds.length
      ? await Location.find({ _id: { $in: uniqueLocationIds } }).lean()
      : [];
    const contacts = leadIds.length
      ? await LeadContacts.find({ lead_id: { $in: leadIds } })
        .sort({ is_primary: -1, created_at: 1 })
        .lean()
      : [];

    const locationMap = new Map(locations.map((loc) => [loc._id.toString(), loc]));
    const contactMap = new Map();

    for (const contact of contacts) {
      const leadId = contact.lead_id?.toString();
      if (!leadId || contactMap.has(leadId)) continue;
      contactMap.set(leadId, {
        name: contact.name || "",
        phone: typeof contact.phone === 'string' && contact.phone ? contact.phone.split(',')[0].trim() : (Array.isArray(contact.phone) ? contact.phone[0] : ""),
        email: typeof contact.email === 'string' && contact.email ? contact.email.split(',')[0].trim() : (Array.isArray(contact.email) ? contact.email[0] : ""),
      });
    }

    const response = leads.map((lead) => {
      const location = lead.location ? locationMap.get(lead.location.toString()) : null;
      const primaryContact = contactMap.get(lead._id.toString()) || null;
      const followup = followupMap.get(lead._id.toString()) || null;
      return {
        ...lead,
        is_existing_company: Boolean(lead.is_existing_client),
        primary_contact: primaryContact,
        next_action: followup?.title || lead.next_action || "",
        next_action_date: followup?.dueDateTime || null,
        ai_score:
          lead.lead_temperature === "hot"
            ? 90
            : lead.lead_temperature === "warm"
              ? 70
              : lead.lead_temperature === "cold"
                ? 50
                : null,
        country: location?.country || "",
        State: location?.State || "",
        city: location?.city || "",
        zone: location?.zone || "",
      };
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getLeadById = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const includeDeleted =
      req.query.include_deleted === "true" || req.query.include_deleted === true;

    const leadFilter = {
      _id: req.params.id,
      ...(includeDeleted
        ? {}
        : { $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }] }),
    };

    if (!isPrivilegedUser(req.user)) {
      leadFilter.assigned_to = req.user?._id || null;
    }

    const lead = await Leads.findOne(leadFilter).lean();

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    let location = null;
    if (lead.location) {
      location = await Location.findById(lead.location).lean();
    }

    const contacts = await LeadContacts.find({ lead_id: lead._id })
      .sort({ is_primary: -1, created_at: 1 })
      .lean();

    const followups = await Followup.find({
      leadId: lead._id,
      is_deleted: false,
    })
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    const contactHistoryFromFollowups = followups.map((f) => ({
      followup_id: f._id,
      contacted_at: f.lastContactDate || f.createdAt || null,
      mode: f.actionType || "other",
      reply: "",
      notes: "",
      next_action: f.title || "",
      next_action_date: f.dueDateTime || null,
      is_completed: f.status === "completed",
      completed_at: f.completedAt || null,
    }));

    const leadWithLocation = {
      ...lead,
      is_existing_company: Boolean(lead.is_existing_client),
      contact_history: contactHistoryFromFollowups,
      next_action:
        followups.find((f) => ["pending", "overdue"].includes(f.status))?.title ||
        lead.next_action ||
        "",
      next_action_date:
        followups.find((f) => ["pending", "overdue"].includes(f.status))?.dueDateTime ||
        null,
      country: location?.country || "",
      State: location?.State || "",
      city: location?.city || "",
      zone: location?.zone || "",
    };

    res.json({ lead: leadWithLocation, contacts, followups });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createLead = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    const actorId = req.user?._id || null;
    await normalizeLegacyLeadFlagsOnce();
    const locationId = await resolveLocationId(req.body);
    const leadPayload = applyLeadDerivations(stripLeadPayloadFields(req.body));

    if (userRole !== "admin" && userRole !== "manager") {
      leadPayload.assigned_to = actorId;
    }
    if (!leadPayload.stage) {
      leadPayload.stage = "P3";
    }
    if (leadPayload.assigned_to && (await isAdminAssignee(leadPayload.assigned_to))) {
      return res.status(400).json({ message: "Lead cannot be assigned to an admin user" });
    }
    await applySourceDependentValidation(leadPayload);

    if (locationId) {
      leadPayload.location = locationId;
    }

    const lead = await Leads.create(leadPayload);

    if (Array.isArray(req.body.contact_history)) {
      await syncLeadFollowupsFromHistory(lead, req.body.contact_history);
    }

    const contacts = normalizeContacts(req.body.contacts);
    if (contacts.length) {
      await LeadContacts.insertMany(
        contacts.map((contact) => ({ ...contact, lead_id: lead._id }))
      );
    }

    // Send notification if lead is assigned to someone
    if (lead.assigned_to) {
      try {
        await Notification.create({
          userId: lead.assigned_to,
          title: "New Lead Assigned",
          message: `You have been assigned a new lead: ${lead.company_name || "Untitled"}`,
          type: "info",
          relatedId: lead._id,
          relatedType: "Lead",
        });
        processPendingNotificationEmails().catch((err) => {
          console.error("lead assignment email dispatch error:", err);
        });
      } catch (notifErr) {
        console.error("Failed to create assignment notification:", notifErr);
      }
    }

    if (req.query.create_as_deal === "true") {
      req.params.id = String(lead._id);
      return exports.convertLeadToDeal(req, res);
    }

    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    await normalizeLegacyLeadFlagsOnce();
    const locationId = await resolveLocationId(req.body);
    const leadPayload = applyLeadDerivations(stripLeadPayloadFields(req.body));

    if (userRole !== "admin" && userRole !== "manager") {
      delete leadPayload.assigned_to;
    }
    if (leadPayload.assigned_to && (await isAdminAssignee(leadPayload.assigned_to))) {
      return res.status(400).json({ message: "Lead cannot be assigned to an admin user" });
    }
    await applySourceDependentValidation(leadPayload);

    if (locationId) {
      leadPayload.location = locationId;
    }

    // Fetch old assigned_to before updating
    const accessFilter = {
      _id: req.params.id,
      $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }],
    };
    if (!isPrivilegedUser(req.user)) {
      accessFilter.assigned_to = req.user?._id || null;
    }

    const oldLead = await Leads.findOne(accessFilter).select("assigned_to company_name").lean();
    if (!oldLead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const lead = await Leads.findOneAndUpdate(
      accessFilter,
      { $set: leadPayload, $unset: { status: "" } },
      { returnDocument: "after" }
    ).lean();

    if (Array.isArray(req.body.contacts)) {
      await LeadContacts.deleteMany({ lead_id: req.params.id });
      const contacts = normalizeContacts(req.body.contacts);
      if (contacts.length) {
        await LeadContacts.insertMany(
          contacts.map((contact) => ({ ...contact, lead_id: req.params.id }))
        );
      }
    }

    if (Array.isArray(req.body.contact_history)) {
      await syncLeadFollowupsFromHistory(lead, req.body.contact_history);
    }

    // Send notification if assigned_to changed to a different user
    const oldAssignee = oldLead?.assigned_to ? String(oldLead.assigned_to) : "";
    const newAssignee = lead.assigned_to ? String(lead.assigned_to) : "";
    if (newAssignee && newAssignee !== oldAssignee) {
      try {
        await Notification.create({
          userId: lead.assigned_to,
          title: "Lead Assigned to You",
          message: `You have been assigned the lead: ${lead.company_name || "Untitled"}`,
          type: "info",
          relatedId: lead._id,
          relatedType: "Lead",
        });
        processPendingNotificationEmails().catch((err) => {
          console.error("lead reassignment email dispatch error:", err);
        });
      } catch (notifErr) {
        console.error("Failed to create assignment notification:", notifErr);
      }
    }

    res.json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can delete leads" });
    }

    await normalizeLegacyLeadFlagsOnce();
    const lead = await Leads.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, is_active: false },
      { returnDocument: "after" }
    );

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({ message: "Lead deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.restoreLead = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can restore leads" });
    }

    await normalizeLegacyLeadFlagsOnce();
    const lead = await Leads.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, is_active: true },
      { returnDocument: "after" }
    );

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({ message: "Lead restored successfully", lead });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.convertLeadToDeal = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const lead = await Leads.findOne({
      _id: req.params.id,
      $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }],
    });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const actorId = await resolveConversionActorId(lead, req);
    if (!actorId) {
      return res.status(400).json({
        message: "No valid user found for conversion (createdBy/assignedBy).",
      });
    }

    if (lead.converted_deal_id) {
      const existingDeal = await Deal.findById(lead.converted_deal_id).lean();
      return res.json({
        message: "Lead already converted to deal",
        lead,
        deal: existingDeal,
      });
    }

    const requestedDealName = String(
      req.body?.deal_name || req.body?.dealName || ""
    ).trim();
    if (!requestedDealName) {
      return res.status(400).json({ message: "Deal name is required" });
    }

    const industryId = await resolveIndustryId(lead.industry);

    const normalizedCompanyName = (lead.company_name || "").trim();
    let client = normalizedCompanyName
      ? await Client.findOne({
        name: new RegExp(`^${escapeRegExp(normalizedCompanyName)}$`, "i"),
        is_deleted: { $ne: true },
      })
      : null;

    if (!client) {
      client = await Client.create({
        name: normalizedCompanyName || `Converted Client ${String(lead._id).slice(-6)}`,
        industry: industryId,
        Address: lead.Address || "",
        employeeCount: lead.employee_count || null,
        turnoverRange: lead.turnover_range || "",
        website: lead.website || "",
        source: lead.source || null,
        deal_count: 0,
        createdBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        is_deleted: false,
        location: lead.location || null,
      });
    } else {
      await Client.updateOne(
        { _id: client._id },
        {
          $set: {
            industry: client.industry || industryId,
            Address: client.Address || lead.Address || "",
            employeeCount:
              client.employeeCount ?? lead.employee_count ?? null,
            turnoverRange: client.turnoverRange || lead.turnover_range || "",
            website: client.website || lead.website || "",
            source: client.source || lead.source || null,
            location: client.location || lead.location || null,
            updatedAt: new Date(),
            is_deleted: false,
          },
        }
      );
    }

    const leadContacts = await LeadContacts.find({ lead_id: lead._id })
      .sort({ is_primary: -1, created_at: 1 })
      .lean();

    if (leadContacts.length) {
      const existingClientContacts = await ClientContact.find({
        client_id: String(client._id),
        is_active: true,
      })
        .select("name phone email")
        .lean();

      const contactKey = (c = {}) =>
        [
          String(c.name || "").trim().toLowerCase(),
          String(c.email || "").trim().toLowerCase(),
          String(c.phone || "").trim(),
        ].join("|");

      const existingKeys = new Set(existingClientContacts.map(contactKey));
      const newContacts = leadContacts
        .filter((contact) => String(contact?.name || "").trim())
        .filter((contact) => !existingKeys.has(contactKey(contact)))
        .map((contact, index) => ({
          client_id: String(client._id),
          name: String(contact.name || "").trim(),
          designation: contact.designation || "",
          phone: contact.phone || "",
          email: contact.email || "",
          linkedin: contact.linkedin || "",
          createdBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
          is_deleted: null,
          is_active: true,
          is_primary:
            contact.is_primary === true ||
            (index === 0 && existingClientContacts.length === 0),
        }));

      if (newContacts.length) {
        await ClientContact.insertMany(newContacts);
      }
    }

    const expectedCloseDate = new Date();
    expectedCloseDate.setDate(expectedCloseDate.getDate() + 60);

    const deal = await Deal.create({
      deal_name: requestedDealName,
      client_id: client._id,
      lead_id: lead._id,
      assignedTo: lead.assigned_to || null,
      assignedBy: actorId,
      stage: "P3",
      status: "open",
      dealValue: Number(lead.deal_value_estimate) || 0,
      probability: 10,
      expectedCloseDate,
      aiRiskScore: computeAiRiskScore(lead.lead_temperature),
      isActive: true,
      is_deleted: false,
    });

    await DealStageHistory.create({
      dealId: deal._id,
      stage: "P3",
      movedAt: new Date(),
      movedBy: actorId,
    });
    await Client.updateOne(
      { _id: client._id },
      { $inc: { deal_count: 1 }, $set: { updatedAt: new Date() } }
    );

    lead.converted_to_deal = true;
    lead.is_existing_client = true;
    lead.stage = "P7";
    lead.is_active = false;
    lead.converted_deal_id = deal._id;
    lead.deal_name = requestedDealName;
    await lead.save();

    res.json({
      message: "Lead converted to deal successfully",
      lead,
      client,
      deal,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── helpers for date ranges ───────────────────────────────────────────────
function _startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function _startOfWeek(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}
function _startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function _startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}
function _addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}
function _addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function normalizeLeadsReportPeriod(period) {
  const value = String(period || "monthly").trim().toLowerCase();
  if (value === "quarterly" || value === "quarter") return "quarterly";
  if (value === "yearly" || value === "year") return "yearly";
  return "monthly";
}

function normalizeLeadsReportYear(year, now = new Date()) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 9999) {
    return now.getFullYear();
  }
  return parsed;
}

function normalizeLeadsReportMonth(month, now = new Date()) {
  const parsed = Number.parseInt(month, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return now.getMonth() + 1;
  }
  return parsed;
}

function normalizeLeadsReportQuarter(quarter, now = new Date()) {
  const value = String(quarter || "").trim().toLowerCase();
  if (["q1", "q2", "q3", "q4"].includes(value)) return value;
  const month = now.getMonth();
  if (month < 3) return "q1";
  if (month < 6) return "q2";
  if (month < 9) return "q3";
  return "q4";
}

function getLeadsReportSelection(input, now = new Date()) {
  const period = normalizeLeadsReportPeriod(input?.period);
  return {
    period,
    year: normalizeLeadsReportYear(input?.year, now),
    month: normalizeLeadsReportMonth(input?.month, now),
    quarter: normalizeLeadsReportQuarter(input?.quarter, now),
  };
}

function getLeadsReportRange(input, now = new Date()) {
  const selection = getLeadsReportSelection(input, now);

  if (selection.period === "quarterly") {
    const quarterMonthMap = { q1: 0, q2: 3, q3: 6, q4: 9 };
    const s = new Date(selection.year, quarterMonthMap[selection.quarter], 1);
    return { currentStart: s, currentEnd: _addMonths(s, 3), comparisonLabel: "previous quarter" };
  }
  if (selection.period === "yearly") {
    return {
      currentStart: new Date(selection.year, 0, 1),
      currentEnd: new Date(selection.year + 1, 0, 1),
      comparisonLabel: "previous year"
    };
  }
  const s = new Date(selection.year, selection.month - 1, 1);
  return { currentStart: s, currentEnd: _addMonths(s, 1), comparisonLabel: "previous month" };
}

const getLeadsAnalytics = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const actorId = req.user._id;
    const actorRole = String(req.user.role || "").toLowerCase();
    const isPrivileged = actorRole === "admin" || actorRole === "manager";

    const ranges = getLeadsReportRange(req.query, new Date());
    const { currentStart, currentEnd, comparisonLabel } = ranges;

    const currentMatch = { is_deleted: { $ne: true }, created_at: { $gte: currentStart, $lt: currentEnd } };
    
    // Calculate previous period for growth comparison
    const { currentStart: prevStart, currentEnd: prevEnd } = getLeadsReportRange(
      req.query,
      new Date(currentStart.getTime() - 1)
    );
    const prevMatch = { is_deleted: { $ne: true }, created_at: { $gte: prevStart, $lt: prevEnd } };

    if (!isPrivileged) {
      const oid = mongoose.Types.ObjectId.isValid(actorId) ? new mongoose.Types.ObjectId(actorId) : actorId;
      currentMatch.assigned_to = oid;
      prevMatch.assigned_to = oid;
    }

    const now = new Date();
    const [currentStats, prevStats, sourceAgg, qualityAgg, agingAgg, trendData, currentLeadRows, followupAgg] = await Promise.all([
      Leads.aggregate([
        { $match: currentMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ["$converted_to_deal", true] }, 1, 0] } },
            qualifiedCount: {
              $sum: {
                $cond: [{ $in: ["$stage", ["P4", "P5", "P6", "P7"]] }, 1, 0]
              }
            },
          }
        }
      ]),
      Leads.countDocuments(prevMatch),
      // Source Performance
      Leads.aggregate([
        { $match: currentMatch },
        { $group: { _id: "$source", total: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ["$converted_to_deal", true] }, 1, 0] } } } },
        { $lookup: { from: "sources", localField: "_id", foreignField: "_id", as: "sourceDoc" } },
        { $unwind: { path: "$sourceDoc", preserveNullAndEmptyArrays: true } },
        { $project: { label: { $ifNull: ["$sourceDoc.name", "Unknown"] }, total: 1, converted: 1 } },
        { $sort: { total: -1 } }
      ]),
      // Lead Quality (Temperature)
      Leads.aggregate([
        { $match: currentMatch },
        { $group: { _id: { $toLower: { $ifNull: ["$lead_temperature", "cold"] } }, count: { $sum: 1 } } }
      ]),
      // Lead Aging (Unconverted leads)
      Leads.aggregate([
        { $match: { ...currentMatch, converted_to_deal: { $ne: true }, stage: { $ne: "P7" } } },
        { $project: { days: { $divide: [{ $subtract: [now, "$created_at"] }, 1000 * 60 * 60 * 24] } } },
        { $bucket: { groupBy: "$days", boundaries: [0, 3, 8], default: 8, output: { count: { $sum: 1 } } } }
      ]),
      // Trend Data for chart
      Leads.aggregate([
        { $match: currentMatch },
        { $group: { _id: { year: { $year: "$created_at" }, month: { $month: "$created_at" }, day: { $dayOfMonth: "$created_at" } }, count: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
      ]),
      Leads.find(currentMatch)
        .select("_id company_name lead_temperature stage converted_to_deal last_contact_date created_at assigned_to source")
        .sort({ created_at: -1 })
        .lean(),
      Followup.aggregate([
        { $match: { is_deleted: false, leadId: { $ne: null } } },
        {
          $group: {
            _id: "$leadId",
            totalFollowups: { $sum: 1 },
            meetingCount: {
              $sum: {
                $cond: [{ $eq: ["$kind", "meeting"] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    const stats = currentStats[0] || { total: 0, converted: 0, qualifiedCount: 0 };
    
    // Growth formula: ((Current - Previous) / Previous) * 100
    const growth = prevStats > 0 ? ((stats.total - prevStats) / prevStats) * 100 : (stats.total > 0 ? 100 : 0);

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const leadsTrend = (trendData || []).map(t => ({
      label: `${t._id.day} ${MONTHS[(t._id.month || 1) - 1]}`,
      total: t.count
    }));

    const agingMap = { "0-2": 0, "3-7": 0, "7+": 0 };
    (agingAgg || []).forEach(b => {
      if (b._id === 0) agingMap["0-2"] = b.count;
      else if (b._id === 3) agingMap["3-7"] = b.count;
      else agingMap["7+"] = b.count;
    });

    const followupMap = new Map(
      (followupAgg || [])
        .filter((row) => row?._id)
        .map((row) => [
          String(row._id),
          {
            totalFollowups: Number(row.totalFollowups || 0),
            meetingCount: Number(row.meetingCount || 0),
          },
        ])
    );
    const leadRows = Array.isArray(currentLeadRows) ? currentLeadRows : [];
    const assigneeIds = [...new Set(
      leadRows
        .map((row) => String(row?.assigned_to || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )].map((id) => new mongoose.Types.ObjectId(id));
    const sourceIds = [...new Set(
      leadRows
        .map((row) => String(row?.source || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )].map((id) => new mongoose.Types.ObjectId(id));
    const [assignees, sources] = await Promise.all([
      assigneeIds.length ? User.find({ _id: { $in: assigneeIds } }).select("name email").lean() : [],
      sourceIds.length ? Source.find({ _id: { $in: sourceIds } }).select("name").lean() : [],
    ]);
    const assigneeMap = new Map(
      (assignees || []).map((user) => [String(user?._id || ""), user])
    );
    const sourceMap = new Map(
      (sources || []).map((sourceDoc) => [String(sourceDoc?._id || ""), sourceDoc])
    );
    let contactedCount = 0;
    let uncontactedCount = 0;
    let leadsWithFollowupsCount = 0;

    let convertedWithMeetings = 0;
    let convertedWithActivity = 0;
    let convertedWithoutActivity = 0;
    let totalWithMeetings = 0;
    let totalWithActivity = 0;
    let totalWithoutActivity = 0;
    const tableRows = [];

    for (const leadRow of leadRows) {
      const leadId = String(leadRow?._id || "");
      const leadFollowupStats = followupMap.get(leadId) || { totalFollowups: 0, meetingCount: 0 };
      const hasMeetings = leadFollowupStats.meetingCount > 0;
      const hasFollowups = leadFollowupStats.totalFollowups > 0;
      const hasLastContact = Boolean(leadRow?.last_contact_date);
      const hasActivity = hasFollowups || hasLastContact;
      const isConverted =
        leadRow?.converted_to_deal === true ||
        String(leadRow?.stage || "").toUpperCase() === "P7";

      if (hasFollowups) leadsWithFollowupsCount += 1;
      if (hasActivity) contactedCount += 1;
      else uncontactedCount += 1;
      if (hasMeetings) totalWithMeetings += 1;
      if (hasActivity) totalWithActivity += 1;
      else totalWithoutActivity += 1;

      tableRows.push({
        id: leadId,
        companyName: leadRow?.company_name || "Unnamed Lead",
        sourceLabel: sourceMap.get(String(leadRow?.source || ""))?.name || "Unknown",
        status: isConverted ? "converted" : "active",
        leadTemperature: String(leadRow?.lead_temperature || "cold"),
        assignedToName:
          assigneeMap.get(String(leadRow?.assigned_to || ""))?.name ||
          assigneeMap.get(String(leadRow?.assigned_to || ""))?.email ||
          "Unassigned",
        createdAt: leadRow?.created_at || null,
        lastContactDate: leadRow?.last_contact_date || null,
        isContacted: hasActivity,
        isConverted,
        totalFollowups: leadFollowupStats.totalFollowups,
        meetingCount: leadFollowupStats.meetingCount,
      });

      if (!isConverted) continue;

      if (hasMeetings) convertedWithMeetings += 1;
      if (hasActivity) convertedWithActivity += 1;
      else convertedWithoutActivity += 1;
    }

    const conversionInsights = {
      withMeetings: {
        leads: totalWithMeetings,
        converted: convertedWithMeetings,
        rate: totalWithMeetings ? Math.round((convertedWithMeetings / totalWithMeetings) * 100) : 0,
      },
      withActivity: {
        leads: totalWithActivity,
        converted: convertedWithActivity,
        rate: totalWithActivity ? Math.round((convertedWithActivity / totalWithActivity) * 100) : 0,
      },
      withoutActivity: {
        leads: totalWithoutActivity,
        converted: convertedWithoutActivity,
        rate: totalWithoutActivity ? Math.round((convertedWithoutActivity / totalWithoutActivity) * 100) : 0,
      },
    };

    res.json({
      comparisonLabel,
      kpis: {
        total: stats.total,
        contacted: contactedCount,
        converted: stats.converted,
        notConverted: Math.max(0, stats.total - stats.converted),
        uncontacted: uncontactedCount,
        growth: growth,
      },
      funnel: [
        { label: "Leads", count: stats.total },
        { label: "Contacted", count: contactedCount },
        { label: "Qualified", count: stats.qualifiedCount },
        { label: "Converted", count: stats.converted },
      ],
      sourcePerformance: sourceAgg,
      leadQuality: qualityAgg,
      leadAging: [
        { label: "0–2 days", count: agingMap["0-2"] },
        { label: "3–7 days", count: agingMap["3-7"] },
        { label: "7+ days", count: agingMap["7+"] },
      ],
      leadsTrend,
      conversionInsights,
      tableRows,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getLeadsAnalytics = getLeadsAnalytics;
