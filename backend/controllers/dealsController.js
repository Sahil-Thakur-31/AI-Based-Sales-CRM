const Deal = require("../models/deals");
const Leads = require("../models/leads");
const LeadContacts = require("../models/leadContacts");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");

function mapTemperatureFromLead(lead) {
  const temp = (lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return { ai_score: 90, lead_temperature: "hot" };
  if (temp === "warm") return { ai_score: 70, lead_temperature: "warm" };
  return { ai_score: 50, lead_temperature: "cold" };
}

exports.getDeals = async (req, res) => {
  try {
    const deals = await Deal.find({ is_deleted: { $ne: true } })
      .sort({ updatedAt: -1 })
      .lean();

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
      ? await Client.find({ _id: { $in: uniqueClientIds }, is_deleted: { $ne: true } }).lean()
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
        company_name: lead?.company_name || client?.name || "Untitled Deal",
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
        converted_to_deal: true,
        primary_contact:
          (leadId ? contactMap.get(leadId) : null) ||
          (clientId ? clientContactMap.get(clientId) : null) ||
          null,
        lead_id: deal.lead_id || null,
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
    const deal = await Deal.findById(req.params.id).lean();
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch deal" });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const update = req.body || {};
    const deal = await Deal.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update deal" });
  }
};

exports.deleteDeal = async (req, res) => {
  try {
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
