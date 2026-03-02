const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const Location = require("../models/location");
const DealStageHistory = require("../models/dealStageHistory");

<<<<<<< HEAD
function mapTemperatureFromLead(lead) {
  const temp = String(lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return { ai_score: 90, lead_temperature: "hot" };
  if (temp === "warm") return { ai_score: 70, lead_temperature: "warm" };
  return { ai_score: 50, lead_temperature: "cold" };
=======
const DEAL_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const DEAL_STATUSES = ["open", "won", "lost"];

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return Boolean(value);
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function mapPrimaryContact(row) {
  if (!row) return null;
  return {
    name: row.name || "",
    phone: row.phone || "",
    email: row.email || ""
  };
}

function buildListRow(deal, leadMap, clientMap, leadContactMap, clientContactMap) {
  const leadId = deal.lead_id ? String(deal.lead_id) : "";
  const clientId = deal.client_id ? String(deal.client_id) : "";

  const lead = leadId ? leadMap.get(leadId) : null;
  const client = clientId ? clientMap.get(clientId) : null;

  const companyName =
    cleanString(lead?.company_name) ||
    cleanString(client?.name) ||
    "Untitled Deal";

  const industry = cleanString(lead?.industry) || cleanString(client?.industry) || "";

  const dealValue =
    typeof deal.dealValue === "number"
      ? deal.dealValue
      : (numberOrNull(lead?.deal_value_estimate) || 0);

  const leadTemperature = cleanString(lead?.lead_temperature) || "";
  const aiScore = numberOrNull(deal.aiRiskScore);

  return {
    _id: deal._id,
    deal_id: deal._id,
    company_name: companyName,
    industry,
    deal_value_estimate: dealValue,
    ai_score: aiScore,
    lead_temperature: leadTemperature,
    last_contact_date: lead?.last_contact_date || deal.updatedAt || deal.createdAt || null,
    next_action: cleanString(lead?.next_action) || "",
    next_action_date: lead?.next_action_date || null,
    status: cleanString(deal.status) || "open",
    stage: cleanString(deal.stage) || "",
    converted_to_deal: true,
    primary_contact:
      (leadId ? leadContactMap.get(leadId) : null) ||
      (clientId ? clientContactMap.get(clientId) : null) ||
      null,
    lead_id: deal.lead_id || null,
    client_id: deal.client_id || null,
    is_deleted: deal.is_deleted === true,
    deleted: deal.is_deleted === true,
    delete_reason: cleanString(deal.deleted_reason),
    isActive: deal.isActive !== false
  };
}

function mapContactDetail(row) {
  return {
    _id: row?._id || null,
    name: row?.name || "",
    designation: row?.designation || "",
    phone: row?.phone || "",
    email: row?.email || "",
    linkedin: row?.linkedin || "",
    address: row?.address || "",
    is_primary: row?.is_primary === true,
    is_active: row?.is_active !== false
  };
}

function mapStageHistory(historyRows) {
  return (historyRows || []).map((row) => ({
    _id: row._id,
    dealId: row.dealId,
    stage: row.stage || "",
    movedAt: row.movedAt || null,
    movedBy: row.movedBy || null
  }));
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
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
<<<<<<< HEAD
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
=======
    const includeDeleted = req.query.include_deleted === "true" || req.query.include_deleted === true;

    const filter = deletedOnly
      ? { is_deleted: true }
      : includeDeleted
        ? {}
        : { is_deleted: { $ne: true } };

    let query = Deal.find(filter).sort({ updatedAt: -1 });
    const limitParam = Number(req.query.limit);
    if (Number.isFinite(limitParam) && limitParam > 0) query = query.limit(limitParam);

    const deals = await query.lean();

    const leadIds = [...new Set(deals.map((row) => row.lead_id).filter(Boolean).map((id) => String(id)))];
    const clientIds = [...new Set(deals.map((row) => row.client_id).filter(Boolean).map((id) => String(id)))];

    const [leads, clients, leadContacts, clientContacts] = await Promise.all([
      leadIds.length ? Leads.find({ _id: { $in: leadIds } }).lean() : [],
      clientIds.length ? Client.find({ _id: { $in: clientIds } }).lean() : [],
      leadIds.length
        ? LeadContacts.find({ lead_id: { $in: leadIds } }).sort({ is_primary: -1, created_at: 1 }).lean()
        : [],
      clientIds.length
        ? ClientContact.find({ client_id: { $in: clientIds }, is_active: { $ne: false } })
          .sort({ createdAt: -1 })
          .lean()
        : []
    ]);

    const leadMap = new Map((leads || []).map((row) => [String(row._id), row]));
    const clientMap = new Map((clients || []).map((row) => [String(row._id), row]));

    const leadContactMap = new Map();
    for (const row of leadContacts || []) {
      const key = row?.lead_id ? String(row.lead_id) : "";
      if (!key || leadContactMap.has(key)) continue;
      leadContactMap.set(key, mapPrimaryContact(row));
    }

    const clientContactMap = new Map();
    for (const row of clientContacts || []) {
      const key = row?.client_id ? String(row.client_id) : "";
      if (!key || clientContactMap.has(key)) continue;
      clientContactMap.set(key, mapPrimaryContact(row));
    }

    const response = deals.map((deal) =>
      buildListRow(deal, leadMap, clientMap, leadContactMap, clientContactMap)
    );
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc

    res.json(response);
  } catch (err) {
    console.error("getDeals error:", err);
    res.status(500).json({ message: "Failed to fetch deals" });
  }
};

exports.getDealById = async (req, res) => {
  try {
<<<<<<< HEAD
    const includeDeleted = req.query.include_deleted === "true" || req.query.include_deleted === true;
    const deal = await Deal.findOne({
      _id: req.params.id,
      ...(includeDeleted ? {} : { is_deleted: { $ne: true } }),
=======
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid deal id" });
    }

    const includeDeleted = req.query.include_deleted === "true" || req.query.include_deleted === true;

    const deal = await Deal.findOne({
      _id: id,
      ...(includeDeleted ? {} : { is_deleted: { $ne: true } })
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
    }).lean();

    if (!deal) return res.status(404).json({ message: "Deal not found" });

<<<<<<< HEAD
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
=======
    const [lead, client, stageHistory] = await Promise.all([
      deal.lead_id ? Leads.findById(deal.lead_id).lean() : null,
      deal.client_id ? Client.findById(deal.client_id).lean() : null,
      DealStageHistory.find({ dealId: deal._id }).sort({ movedAt: -1 }).lean()
    ]);

    const leadContacts = lead
      ? await LeadContacts.find({ lead_id: lead._id }).sort({ is_primary: -1, created_at: 1 }).lean()
      : [];

    const clientContacts = client
      ? await ClientContact.find({
        client_id: String(client._id),
        is_active: { $ne: false }
      }).sort({ createdAt: -1 }).lean()
      : [];

    const contacts = (leadContacts.length ? leadContacts : clientContacts).map(mapContactDetail);

    let location = null;
    const locationId = lead?.location || client?.location;
    if (locationId && isValidObjectId(locationId)) {
      location = await Location.findById(locationId).lean();
    }

    const mappedDeal = {
      _id: deal._id,
      company_name: cleanString(lead?.company_name) || cleanString(client?.name) || "Untitled Deal",
      industry: cleanString(lead?.industry) || cleanString(client?.industry) || "",
      employee_count: lead?.employee_count ?? client?.employeeCount ?? "",
      turnover_range: cleanString(lead?.turnover_range) || cleanString(client?.turnoverRange) || "",
      Address: cleanString(lead?.Address) || cleanString(client?.Address) || "",
      website: cleanString(lead?.website) || cleanString(client?.website) || "",
      source: lead?.source || client?.source || "",
      country: cleanString(location?.country),
      State: cleanString(location?.State || location?.state),
      city: cleanString(location?.city),
      zone: cleanString(location?.zone || location?.area),
      lead_temperature: cleanString(lead?.lead_temperature),
      deal_value_estimate:
        typeof deal.dealValue === "number"
          ? deal.dealValue
          : (numberOrNull(lead?.deal_value_estimate) || 0),
      status: cleanString(deal.status) || "open",
      next_action: cleanString(lead?.next_action),
      next_action_date: lead?.next_action_date || null,
      assigned_to: deal.assignedTo || lead?.assigned_to || "",
      converted_to_deal: true,
      isActive: deal.isActive !== false,
      is_deleted: deal.is_deleted === true,
      deleted_reason: cleanString(deal.deleted_reason),
      lead_id: deal.lead_id || null,
      client_id: deal.client_id || null,
      stage: cleanString(deal.stage),
      probability: deal.probability ?? null,
      expectedCloseDate: deal.expectedCloseDate || null,
      actualCloseDate: deal.actualCloseDate || null,
      aiRiskScore: deal.aiRiskScore ?? null
    };

    res.json({
      deal: mappedDeal,
      contacts,
      stageHistory: mapStageHistory(stageHistory)
    });
  } catch (err) {
    console.error("getDealById error:", err);
    res.status(500).json({ message: "Failed to fetch deal details" });
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
  }
};

exports.updateDeal = async (req, res) => {
  try {
<<<<<<< HEAD
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

=======
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid deal id" });
    }

    const deal = await Deal.findById(id);
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    const prevStage = cleanString(deal.stage);
    const body = req.body || {};

    if (body.client_id !== undefined && isValidObjectId(body.client_id)) deal.client_id = body.client_id;
    if (body.client_contact_Id !== undefined && isValidObjectId(body.client_contact_Id)) {
      deal.client_contact_Id = body.client_contact_Id;
    }
    if (body.assignedTo !== undefined && isValidObjectId(body.assignedTo)) deal.assignedTo = body.assignedTo;
    if (body.assignedBy !== undefined && isValidObjectId(body.assignedBy)) deal.assignedBy = body.assignedBy;
    if (body.lead_id !== undefined && isValidObjectId(body.lead_id)) deal.lead_id = body.lead_id;

    if (body.stage !== undefined) {
      const nextStage = cleanString(body.stage).toUpperCase();
      if (!DEAL_STAGES.includes(nextStage)) {
        return res.status(400).json({ message: "Invalid stage value" });
      }
      deal.stage = nextStage;
    }

    if (body.status !== undefined) {
      const nextStatus = cleanString(body.status).toLowerCase();
      if (!DEAL_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      deal.status = nextStatus;
    }

    if (body.dealValue !== undefined || body.deal_value_estimate !== undefined) {
      const value = numberOrNull(body.dealValue ?? body.deal_value_estimate);
      if (value !== null) deal.dealValue = value;
    }

    if (body.probability !== undefined) {
      const probability = numberOrNull(body.probability);
      if (probability !== null) deal.probability = probability;
    }

    if (body.aiRiskScore !== undefined || body.ai_score !== undefined) {
      const ai = numberOrNull(body.aiRiskScore ?? body.ai_score);
      if (ai !== null) deal.aiRiskScore = ai;
    }

    if (body.expectedCloseDate !== undefined) deal.expectedCloseDate = dateOrNull(body.expectedCloseDate);
    if (body.actualCloseDate !== undefined) deal.actualCloseDate = dateOrNull(body.actualCloseDate);

    if (body.isActive !== undefined || body.is_active !== undefined) {
      const active = boolOrNull(body.isActive ?? body.is_active);
      if (active !== null) deal.isActive = active;
    }

    await deal.save();

    if (deal.stage && deal.stage !== prevStage) {
      await DealStageHistory.create({
        dealId: deal._id,
        stage: deal.stage,
        movedAt: new Date(),
        movedBy: req.user?._id || null
      });
    }

    res.json({ message: "Deal updated successfully", deal });
  } catch (err) {
<<<<<<< HEAD
    res.status(400).json({ message: err.message });
=======
    console.error("updateDeal error:", err);
    res.status(500).json({ message: "Failed to update deal" });
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
  }
};

exports.deleteDeal = async (req, res) => {
  try {
<<<<<<< HEAD
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
=======
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid deal id" });
    }

    const deal = await Deal.findById(id);
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    const reason = cleanString(req.body?.reason);
    if (!reason) {
      return res.status(400).json({ message: "Delete reason is required" });
    }

    deal.is_deleted = true;
    deal.deleted_reason = reason;
    deal.deleted_at = new Date();
    deal.isActive = false;
    await deal.save();

    res.json({ message: "Deal deleted successfully", deal });
  } catch (err) {
    console.error("deleteDeal error:", err);
    res.status(500).json({ message: "Failed to delete deal" });
>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
  }
};

exports.restoreDeal = async (req, res) => {
  try {
<<<<<<< HEAD
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
=======
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid deal id" });
    }

    const deal = await Deal.findById(id);
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    deal.is_deleted = false;
    deal.deleted_reason = "";
    deal.deleted_at = null;
    deal.isActive = true;
    await deal.save();

    res.json({ message: "Deal restored successfully", deal });
  } catch (err) {
    console.error("restoreDeal error:", err);
    res.status(500).json({ message: "Failed to restore deal" });
  }
};

>>>>>>> b4bfd4f179cd89596bdde0f2873b761f2c4d6adc
