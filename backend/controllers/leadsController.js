const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Location = require("../models/location");
const Followup = require("../models/followUp");
const Deal = require("../models/deals");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const Industry = require("../models/industries");
const User = require("../models/users");
const DealStageHistory = require("../models/dealStageHistory");
let legacyLeadFlagsNormalized = false;
let legacyLeadFlagsNormalizationPromise = null;

function normalizeContacts(contacts = []) {
  if (!Array.isArray(contacts)) return [];

  return contacts
    .filter((contact) => contact && (contact.name || contact.phone || contact.email))
    .map((contact, index) => ({
      name: contact.name || "",
      designation: contact.designation || "",
      phone: contact.phone || "",
      email: contact.email || "",
      linkedin: contact.linkedin || "",
      address: contact.address || "",
      is_primary: index === 0 ? true : Boolean(contact.is_primary),
    }));
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
  delete cleaned.contacts;
  delete cleaned.country;
  delete cleaned.State;
  delete cleaned.city;
  delete cleaned.zone;
  delete cleaned.contact_history;
  delete cleaned.next_action_date;
  delete cleaned.ai_score;

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

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        { new: true, upsert: false }
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
          phone: c.phone || "",
          email: c.email || "",
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
          phone: c.phone || "",
          email: c.email || "",
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
    const limit = Number(req.query.limit);

    const filter = deletedOnly
      ? { is_deleted: true }
      : {
        $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }],
        converted_to_deal: { $ne: true },
      };
    let leadsQuery = Leads.find(filter).sort({ updated_at: -1 });
    if (!Number.isNaN(limit) && limit > 0) {
      leadsQuery = leadsQuery.limit(limit);
    }

    const leads = await leadsQuery.lean();
    const leadIds = leads.map((lead) => lead._id);
    const followupMap = await fetchLeadFollowupMap(leadIds);

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
        phone: contact.phone || "",
        email: contact.email || "",
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

    const lead = await Leads.findOne({
      _id: req.params.id,
      ...(includeDeleted
        ? {}
        : { $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }] }),
    }).lean();

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
    await normalizeLegacyLeadFlagsOnce();
    const locationId = await resolveLocationId(req.body);
    const leadPayload = applyLeadDerivations(stripLeadPayloadFields(req.body));

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

    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateLead = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const locationId = await resolveLocationId(req.body);
    const leadPayload = applyLeadDerivations(stripLeadPayloadFields(req.body));

    if (locationId) {
      leadPayload.location = locationId;
    }

    const lead = await Leads.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [{ is_deleted: false }, { is_deleted: { $exists: false } }],
      },
      leadPayload,
      { new: true }
    ).lean();

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

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

    res.json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    await normalizeLegacyLeadFlagsOnce();
    const lead = await Leads.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, is_active: false },
      { new: true }
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
    await normalizeLegacyLeadFlagsOnce();
    const lead = await Leads.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, is_active: true },
      { new: true }
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

    const primaryLeadContact = await LeadContacts.findOne({ lead_id: lead._id })
      .sort({ is_primary: -1, created_at: 1 })
      .lean();

    let clientContact = null;
    if (primaryLeadContact?.name) {
      clientContact = await ClientContact.findOne({
        client_id: String(client._id),
        name: primaryLeadContact.name,
        is_active: true,
      });

      if (!clientContact) {
        clientContact = await ClientContact.create({
          client_id: String(client._id),
          name: primaryLeadContact.name,
          designation: primaryLeadContact.designation || "",
          phone: primaryLeadContact.phone || "",
          email: primaryLeadContact.email || "",
          linkedin: primaryLeadContact.linkedin || "",
          createdBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
          is_deleted: null,
          is_active: true,
        });
      }
    }

    const expectedCloseDate = new Date();
    expectedCloseDate.setDate(expectedCloseDate.getDate() + 30);

    const deal = await Deal.create({
      client_id: client._id,
      clientName: client.name || lead.company_name || "",
      client_contact_Id: clientContact?._id || null,
      lead_id: lead._id,
      assignedTo: lead.assigned_to || null,
      assignedBy: actorId,
      stage: "P1",
      dealValue: Number(lead.deal_value_estimate) || 0,
      probability: 10,
      expectedCloseDate,
      status: "open",
      aiRiskScore: computeAiRiskScore(lead.lead_temperature),
      isActive: true,
      is_deleted: false,
    });

    await DealStageHistory.create({
      dealId: deal._id,
      stage: "P1",
      movedAt: new Date(),
      movedBy: actorId,
    });

    await Client.updateOne(
      { _id: client._id },
      { $inc: { deal_count: 1 }, $set: { updatedAt: new Date() } }
    );

    lead.converted_to_deal = true;
    lead.is_existing_client = true;
    lead.status = "converted";
    lead.converted_deal_id = deal._id;
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
