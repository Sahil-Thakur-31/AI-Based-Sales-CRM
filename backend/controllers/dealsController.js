const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const DealStageHistory = require("../models/dealStageHistory");

const DEAL_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const DEAL_STATUSES = ["open", "won", "lost"];

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function dateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function boolOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function safeDateDisplay(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function buildDealDetail(dealDoc) {
  const deal = dealDoc.toObject ? dealDoc.toObject() : dealDoc;

  let client = null;
  if (deal.client_id) {
    client = await Client.findOne({
      _id: deal.client_id,
      is_deleted: { $ne: true }
    }).lean();
  }

  let contacts = [];
  if (deal.client_id) {
    contacts = await ClientContact.find({
      client_id: String(deal.client_id),
      is_active: { $ne: false }
    })
    .sort({ createdAt: -1 })
    .lean();
  }

  if (contacts.length === 0 && deal.client_contact_Id) {
    const primaryContact = await ClientContact.findById(deal.client_contact_Id).lean();
    if (primaryContact) contacts = [primaryContact];
  }

  const stageHistory = await DealStageHistory.find({
    dealId: deal._id
  })
  .sort({ movedAt: -1 })
  .lean();

  return {
    deal: {
      _id: deal._id,
      client_id: deal.client_id || null,
      client_contact_Id: deal.client_contact_Id || null,
      assignedTo: deal.assignedTo || null,
      stage: deal.stage || "",
      dealValue: deal.dealValue ?? null,
      probability: deal.probability ?? null,
      expectedCloseDate: safeDateDisplay(deal.expectedCloseDate),
      actualCloseDate: safeDateDisplay(deal.actualCloseDate),
      status: deal.status || "open",
      aiRiskScore: deal.aiRiskScore ?? null,
      lead_id: deal.lead_id || null,
      isActive: deal.isActive ?? null,
      isDeleted: deal.is_deleted ?? false,
      assignedBy: deal.assignedBy || null,
      createdAt: safeDateDisplay(deal.createdAt),
      updatedAt: safeDateDisplay(deal.updatedAt)
    },
    client: client
      ? {
        _id: client._id,
        name: client.name || "",
        industry: client.industry || null,
        Address: client.Address || "",
        employeeCount: client.employeeCount ?? null,
        turnoverRange: client.turnoverRange || "",
        website: client.website || "",
        source: client.source || null,
        deal_count: client.deal_count ?? null,
        GST_no: client.GST_no || "",
        URD: client.URD || "",
        Aadhar_doc: client.Aadhar_doc || "",
        PanCard_doc: client.PanCard_doc || "",
        Other_docs: client.Other_docs || "",
        location: client.location || null
      }
      : null,
    contacts: contacts.map((contact) => ({
      _id: contact._id,
      client_id: contact.client_id || "",
      name: contact.name || "",
      designation: contact.designation || "",
      phone: contact.phone || "",
      email: contact.email || "",
      linkedin: contact.linkedin || "",
      is_active: contact.is_active ?? true,
      is_deleted: contact.is_deleted || null,
      createdAt: safeDateDisplay(contact.createdAt),
      updatedAt: safeDateDisplay(contact.updatedAt)
    })),
    stageHistory: stageHistory.map((h) => ({
      _id: h._id,
      dealId: h.dealId,
      stage: h.stage || "",
      movedAt: safeDateDisplay(h.movedAt),
      movedBy: h.movedBy || null
    }))
  };
}

exports.getDeals = async (req, res) => {

  try {
    const deletedOnly =
      req.query.deleted_only === "true" || req.query.deleted_only === true;

    const filter = deletedOnly
      ? { is_deleted: true }
      : { is_deleted: { $ne: true } };

    let dealsQuery = Deal.find(filter).sort({ updatedAt: -1 });

    const limitParam = Number(req.query.limit);
    if (!Number.isNaN(limitParam) && limitParam > 0) {
      dealsQuery = dealsQuery.limit(limitParam);
    }

    const deals = await dealsQuery.lean();

    const leadIds = deals
      .map((deal) => deal.lead_id)
      .filter(Boolean)
      .map((id) => id.toString());

    const clientIds = [
      ...new Set(
        deals
        .map((deal) => deal.client_id ? String(deal.client_id) : "")
        .filter(Boolean)
      )
    ];

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

      const clientName = deal.client_id
        ? (clientMap.get(String(deal.client_id)) || deal.clientName || "Unknown Client")
        : (deal.clientName || "Unlinked Deal");

      return {
        _id: deal._id,
        deal_id: deal._id,
        company_name: lead?.company_name || client?.name || deal.clientName || "Untitled Deal",
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

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
