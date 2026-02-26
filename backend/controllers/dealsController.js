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

    const deals = await Deal.find({
      is_deleted: { $ne: true }
    })
    .sort({ createdAt: -1 })
    .select("client_id clientName stage status dealValue");

    const clientIds = [
      ...new Set(
        deals
        .map((deal) => deal.client_id ? String(deal.client_id) : "")
        .filter(Boolean)
      )
    ];

    const clients = await Client.find({
      _id: { $in: clientIds },
      is_deleted: { $ne: true }
    })
    .select("name");

    const clientMap = new Map(
      clients.map((client) => [String(client._id), client.name])
    );

    const response = deals.map((deal) => {

      const clientName = deal.client_id
        ? (clientMap.get(String(deal.client_id)) || deal.clientName || "Unknown Client")
        : (deal.clientName || "Unlinked Deal");

      return {
        _id: deal._id,
        stage: deal.stage || "-",
        status: deal.status || "open",
        dealValue: deal.dealValue || 0,
        clientId: deal.client_id || null,
        clientName,
        label: `${deal.stage || "Deal"} - ${clientName}`
      };

    });

    res.json(response);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch deals"
    });

  }

};

exports.getDealById = async (req, res) => {

  try {

    const deal = await Deal.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true }
    });

    if (!deal) {
      return res.status(404).json({
        message: "Deal not found"
      });
    }

    const detail = await buildDealDetail(deal);
    res.json(detail);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch deal details"
    });

  }

};

exports.updateDeal = async (req, res) => {

  try {

    const { deal: dealInput = {}, client: clientInput = null, contacts: contactsInput = [] } = req.body || {};

    const existingDeal = await Deal.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true }
    });

    if (!existingDeal) {
      return res.status(404).json({
        message: "Deal not found"
      });
    }

    const previousStage = existingDeal.stage || "";
    const dealUpdate = {
      updatedAt: new Date()
    };

    if (dealInput.stage !== undefined) {
      const nextStage = cleanString(dealInput.stage);
      if (nextStage && !DEAL_STAGES.includes(nextStage)) {
        return res.status(400).json({
          message: "Invalid stage"
        });
      }
      dealUpdate.stage = nextStage || null;
    }

    if (dealInput.status !== undefined) {
      const nextStatus = cleanString(dealInput.status).toLowerCase();
      if (nextStatus && !DEAL_STATUSES.includes(nextStatus)) {
        return res.status(400).json({
          message: "Invalid status"
        });
      }
      dealUpdate.status = nextStatus || null;
    }

    if (dealInput.dealValue !== undefined)
      dealUpdate.dealValue = numberOrNull(dealInput.dealValue);

    if (dealInput.probability !== undefined)
      dealUpdate.probability = numberOrNull(dealInput.probability);

    if (dealInput.expectedCloseDate !== undefined)
      dealUpdate.expectedCloseDate = dateOrNull(dealInput.expectedCloseDate);

    if (dealInput.actualCloseDate !== undefined)
      dealUpdate.actualCloseDate = dateOrNull(dealInput.actualCloseDate);

    if (dealInput.aiRiskScore !== undefined)
      dealUpdate.aiRiskScore = numberOrNull(dealInput.aiRiskScore);

    if (dealInput.assignedTo !== undefined)
      dealUpdate.assignedTo = dealInput.assignedTo || null;

    if (dealInput.assignedBy !== undefined)
      dealUpdate.assignedBy = dealInput.assignedBy || null;

    if (dealInput.lead_id !== undefined)
      dealUpdate.lead_id = dealInput.lead_id || null;

    if (dealInput.client_contact_Id !== undefined)
      dealUpdate.client_contact_Id = dealInput.client_contact_Id || null;

    if (dealInput.isActive !== undefined)
      dealUpdate.isActive = boolOrNull(dealInput.isActive);

    if (dealInput.isDeleted !== undefined || dealInput.is_deleted !== undefined) {
      const deletedValue = dealInput.isDeleted !== undefined
        ? dealInput.isDeleted
        : dealInput.is_deleted;
      dealUpdate.is_deleted = boolOrNull(deletedValue);
    }

    const updatedDeal = await Deal.findByIdAndUpdate(
      existingDeal._id,
      {
        $set: dealUpdate
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (existingDeal.client_id && clientInput && typeof clientInput === "object") {
      const clientUpdate = {
        updatedAt: new Date()
      };

      if (clientInput.name !== undefined)
        clientUpdate.name = cleanString(clientInput.name);
      if (clientInput.industry !== undefined)
        clientUpdate.industry = clientInput.industry || null;
      if (clientInput.Address !== undefined)
        clientUpdate.Address = cleanString(clientInput.Address);
      if (clientInput.employeeCount !== undefined)
        clientUpdate.employeeCount = numberOrNull(clientInput.employeeCount);
      if (clientInput.turnoverRange !== undefined)
        clientUpdate.turnoverRange = cleanString(clientInput.turnoverRange);
      if (clientInput.website !== undefined)
        clientUpdate.website = cleanString(clientInput.website);
      if (clientInput.source !== undefined)
        clientUpdate.source = clientInput.source || null;
      if (clientInput.GST_no !== undefined)
        clientUpdate.GST_no = cleanString(clientInput.GST_no);
      if (clientInput.URD !== undefined)
        clientUpdate.URD = cleanString(clientInput.URD);
      if (clientInput.Aadhar_doc !== undefined)
        clientUpdate.Aadhar_doc = cleanString(clientInput.Aadhar_doc);
      if (clientInput.PanCard_doc !== undefined)
        clientUpdate.PanCard_doc = cleanString(clientInput.PanCard_doc);
      if (clientInput.Other_docs !== undefined)
        clientUpdate.Other_docs = cleanString(clientInput.Other_docs);
      if (clientInput.location !== undefined)
        clientUpdate.location = clientInput.location || null;

      if (Object.keys(clientUpdate).length > 1) {
        await Client.findByIdAndUpdate(
          existingDeal.client_id,
          { $set: clientUpdate },
          { runValidators: false }
        );
      }
    }

    if (Array.isArray(contactsInput)) {
      for (const contact of contactsInput) {
        if (!contact || !contact._id) continue;

        const contactUpdate = {
          updatedAt: new Date()
        };

        if (contact.name !== undefined)
          contactUpdate.name = cleanString(contact.name);
        if (contact.designation !== undefined)
          contactUpdate.designation = cleanString(contact.designation);
        if (contact.phone !== undefined)
          contactUpdate.phone = cleanString(contact.phone);
        if (contact.email !== undefined)
          contactUpdate.email = cleanString(contact.email);
        if (contact.linkedin !== undefined)
          contactUpdate.linkedin = cleanString(contact.linkedin);
        if (contact.is_active !== undefined)
          contactUpdate.is_active = boolOrNull(contact.is_active);

        if (Object.keys(contactUpdate).length > 1) {
          await ClientContact.findByIdAndUpdate(
            contact._id,
            { $set: contactUpdate },
            { runValidators: false }
          );
        }
      }
    }

    if (
      dealUpdate.stage !== undefined &&
      dealUpdate.stage &&
      dealUpdate.stage !== previousStage
    ) {
      await DealStageHistory.create({
        dealId: updatedDeal._id,
        stage: dealUpdate.stage,
        movedAt: new Date(),
        movedBy: req.user?._id || null
      });
    }

    const detail = await buildDealDetail(updatedDeal);
    res.json(detail);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to update deal"
    });

  }

};
