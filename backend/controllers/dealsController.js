const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const User = require("../models/users");

function mapTemperatureFromLead(lead) {
  const temp = (lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return { ai_score: 90, lead_temperature: "hot" };
  if (temp === "warm") return { ai_score: 70, lead_temperature: "warm" };
  return { ai_score: 50, lead_temperature: "cold" };
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

    const uniqueLeadIds = [...new Set(leadIds)];
    const clientIds = deals
      .map((deal) => deal.client_id)
      .filter(Boolean)
      .map((id) => id.toString());
    const uniqueClientIds = [...new Set(clientIds)];

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
        client_id: deal.client_id || null,
        clientId: deal.client_id || null,
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

// fallback handlers used by routes
exports.getDealById = async (req, res) => {
  try {
    const includeDeleted =
      req.query.include_deleted === "true" || req.query.include_deleted === true;

    const filter = { _id: req.params.id };
    if (!includeDeleted) {
      filter.is_deleted = { $ne: true };
    }

    const deal = await Deal.findOne(filter).lean();
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
      company_name:
        lead?.company_name || client?.name || deal.clientName || "",
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
    const update = req.body || {};
    delete update._id;

    if (userRole !== "admin" && userRole !== "manager") {
      delete update.assignedTo;
      delete update.assigned_to;
    }

    const requestedAssignee = update.assignedTo || update.assigned_to;
    if (requestedAssignee && (await isAdminAssignee(requestedAssignee))) {
      return res.status(400).json({ message: "Deal cannot be assigned to an admin user" });
    }

    const deal = await Deal.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" }).lean();
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
