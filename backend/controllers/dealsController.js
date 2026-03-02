const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");

function mapTemperatureFromLead(lead) {
  const temp = String(lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return { ai_score: 90, lead_temperature: "hot" };
  if (temp === "warm") return { ai_score: 70, lead_temperature: "warm" };
  return { ai_score: 50, lead_temperature: "cold" };
}

function toDateOrUndefined(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toNumberOrUndefined(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function toBooleanOrUndefined(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const v = String(value).toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return Boolean(value);
}

exports.getDeals = async (req, res) => {
  try {
    const deletedOnly = req.query.deleted_only === "true" || req.query.deleted_only === true;
    const limitParam = Number(req.query.limit);

    const filter = deletedOnly ? { is_deleted: true } : { is_deleted: { $ne: true } };

    let dealsQuery = Deal.find(filter).sort({ updatedAt: -1 });
    if (!Number.isNaN(limitParam) && limitParam > 0) {
      dealsQuery = dealsQuery.limit(limitParam);
    }

    const deals = await dealsQuery.lean();

    const leadIds = [...new Set(deals.map((d) => d.lead_id).filter(Boolean).map((id) => String(id)))];
    const clientIds = [...new Set(deals.map((d) => d.client_id).filter(Boolean).map((id) => String(id)))];

    const [leads, leadContacts, clients, clientContacts] = await Promise.all([
      leadIds.length ? Leads.find({ _id: { $in: leadIds } }).lean() : [],
      leadIds.length
        ? LeadContacts.find({ lead_id: { $in: leadIds } }).sort({ is_primary: -1, created_at: 1 }).lean()
        : [],
      clientIds.length ? Client.find({ _id: { $in: clientIds }, is_deleted: { $ne: true } }).lean() : [],
      clientIds.length
        ? ClientContact.find({ client_id: { $in: clientIds }, is_active: true }).lean()
        : [],
    ]);

    const leadMap = new Map(leads.map((lead) => [String(lead._id), lead]));
    const clientMap = new Map(clients.map((client) => [String(client._id), client]));
    const leadContactMap = new Map();
    const clientContactMap = new Map();

    for (const contact of leadContacts) {
      const key = String(contact.lead_id || "");
      if (!key || leadContactMap.has(key)) continue;
      leadContactMap.set(key, {
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
      });
    }

    for (const contact of clientContacts) {
      const key = String(contact.client_id || "");
      if (!key || clientContactMap.has(key)) continue;
      clientContactMap.set(key, {
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
      });
    }

    const response = deals.map((deal) => {
      const lead = deal.lead_id ? leadMap.get(String(deal.lead_id)) : null;
      const client = deal.client_id ? clientMap.get(String(deal.client_id)) : null;
      const temperatureData = mapTemperatureFromLead(lead);

      return {
        _id: deal._id,
        deal_id: deal._id,
        client_id: deal.client_id || null,
        company_name: lead?.company_name || client?.name || "Untitled Deal",
        industry: lead?.industry || "",
        deal_value_estimate:
          typeof deal.dealValue === "number" ? deal.dealValue : (lead?.deal_value_estimate || 0),
        ai_score: temperatureData.ai_score,
        lead_temperature: temperatureData.lead_temperature,
        last_contact_date: lead?.last_contact_date || deal.updatedAt || null,
        next_action: lead?.next_action || "",
        next_action_date: null,
        status: deal.status || "open",
        stage: deal.stage || "",
        converted_to_deal: true,
        primary_contact:
          (deal.lead_id ? leadContactMap.get(String(deal.lead_id)) : null) ||
          (deal.client_id ? clientContactMap.get(String(deal.client_id)) : null) ||
          null,
        lead_id: deal.lead_id || null,
        is_deleted: Boolean(deal.is_deleted),
        deleted: Boolean(deal.is_deleted),
        delete_reason: deal.deleted_reason || "",
        isActive: deal.isActive !== false,
      };
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getDealById = async (req, res) => {
  try {
    const includeDeleted = req.query.include_deleted === "true" || req.query.include_deleted === true;
    const deal = await Deal.findOne({
      _id: req.params.id,
      ...(includeDeleted ? {} : { is_deleted: { $ne: true } }),
    }).lean();

    if (!deal) return res.status(404).json({ message: "Deal not found" });

    const lead = deal.lead_id ? await Leads.findById(deal.lead_id).lean() : null;
    let contacts = [];

    if (deal.lead_id) {
      contacts = await LeadContacts.find({ lead_id: deal.lead_id })
        .sort({ is_primary: -1, created_at: 1 })
        .lean();
    }

    if (!contacts.length && deal.client_id) {
      contacts = await ClientContact.find({
        client_id: String(deal.client_id),
        is_active: true,
      }).lean();
    }

    const responseDeal = {
      ...deal,
      company_name: lead?.company_name || "",
      industry: lead?.industry || "",
      employee_count: lead?.employee_count ?? null,
      turnover_range: lead?.turnover_range || "",
      Address: lead?.Address || "",
      website: lead?.website || "",
      source: lead?.source || null,
      deal_value_estimate:
        typeof deal.dealValue === "number" ? deal.dealValue : (lead?.deal_value_estimate || 0),
      assigned_to: deal.assignedTo || lead?.assigned_to || null,
      lead_temperature: lead?.lead_temperature || "",
      status: deal.status || "open",
      last_contact_date: lead?.last_contact_date || deal.updatedAt || null,
      next_action: lead?.next_action || "",
      contact_history: [],
    };

    res.json({ deal: responseDeal, contacts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const payload = {
      stage: req.body.stage,
      status: req.body.status,
      dealValue: toNumberOrUndefined(req.body.dealValue ?? req.body.deal_value_estimate),
      probability: toNumberOrUndefined(req.body.probability),
      expectedCloseDate: toDateOrUndefined(req.body.expectedCloseDate),
      actualCloseDate: toDateOrUndefined(req.body.actualCloseDate),
      aiRiskScore: toNumberOrUndefined(req.body.aiRiskScore),
      assignedTo: req.body.assignedTo ?? req.body.assigned_to,
      isActive: toBooleanOrUndefined(req.body.isActive ?? req.body.is_active),
    };

    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });

    const deal = await Deal.findOneAndUpdate(
      { _id: req.params.id, is_deleted: { $ne: true } },
      payload,
      { new: true }
    ).lean();

    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteDeal = async (req, res) => {
  try {
    const userRole = String(req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can delete deals" });
    }

    const reason = String(req.body?.reason || "").trim();

    const deal = await Deal.findByIdAndUpdate(
      req.params.id,
      {
        is_deleted: true,
        isActive: false,
        deleted_reason: reason,
        deleted_at: new Date(),
      },
      { new: true }
    ).lean();

    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json({ message: "Deal deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.restoreDeal = async (req, res) => {
  try {
    const userRole = String(req.user?.role || "").toLowerCase();
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({ message: "Forbidden: Only Admin or Manager can restore deals" });
    }

    const deal = await Deal.findByIdAndUpdate(
      req.params.id,
      {
        is_deleted: false,
        isActive: true,
        deleted_reason: "",
        deleted_at: null,
      },
      { new: true }
    ).lean();

    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json({ message: "Deal restored successfully", deal });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getClientSuggestions = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));

    if (!q || q.length < 2) return res.json([]);

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const clients = await Client.find({
      is_deleted: { $ne: true },
      name: regex,
    })
      .limit(limit)
      .select("_id name")
      .lean();

    res.json(clients.map((c) => ({ _id: c._id, name: c.name || "" })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
