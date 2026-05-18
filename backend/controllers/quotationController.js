const Quotation = require("../models/quatations");
const QuotationItem = require("../models/quatation_item");
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const DealStageHistory = require("../models/dealStageHistory");
const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const Product = require("../models/products");
const Tax = require("../models/taxes");
const User = require("../models/users");
const QuotationClause = require("../models/quotationClauses");
const QuotationPaymentTerms = require("../models/quotationPaymentTerms");
const Industry = require("../models/industries");

const MAX_PERCENT = 100;
const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "negotiation",
  "approved",
  "rejected",
  "expired"
];
const VERSION_ALLOWED_PREVIOUS_STATUSES = ["expired", "rejected"];
const QUOTATION_TYPES = new Set(["deal", "lead"]);
const VIEW_ONLY_ADMIN_MESSAGE = "Admins can only view quotations";
const DEAL_WON_STAGE = "P7";
const QUOTATION_CREATED_STAGE = "P1";

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function getQuotationRevenueAmount(quotation = {}) {
  const subtotal = Number(quotation.subtotalAmount);
  if (Number.isFinite(subtotal) && subtotal >= 0) return round2(subtotal);

  const grandTotal = Number(quotation.grandTotal || 0);
  const taxAmount = Number(quotation.taxAmount || 0);
  return round2(Math.max(0, grandTotal - taxAmount));
}

function buildQuoteNumber(sourceId, quoteDate, version, quoteType = "deal") {
  const year = new Date(quoteDate || Date.now()).getFullYear();
  const entityToken = String(sourceId).slice(-6).toUpperCase();
  const typeToken = String(quoteType || "deal").toLowerCase() === "lead" ? "LD" : "DL";
  const versionToken = String(version).padStart(2, "0");
  return `QT-${year}-${typeToken}${entityToken}-${versionToken}`;
}

function normalizeQuoteType(value) {
  const type = String(value || "").trim().toLowerCase();
  return QUOTATION_TYPES.has(type) ? type : "deal";
}

function inferQuoteType(quotation = {}) {
  if (quotation?.quoteType && QUOTATION_TYPES.has(String(quotation.quoteType).toLowerCase())) {
    return String(quotation.quoteType).toLowerCase();
  }
  return quotation?.leadId ? "lead" : "deal";
}

function getSourceFilter(quoteType, sourceId, options = {}) {
  const { includeLegacyDealQuotes = true } = options;
  if (quoteType === "lead") return { quoteType: "lead", leadId: sourceId };
  if (!includeLegacyDealQuotes) return { quoteType: "deal", dealId: sourceId };
  return {
    dealId: sourceId,
    $or: [{ quoteType: "deal" }, { quoteType: { $exists: false } }, { quoteType: null }]
  };
}

function getDuplicateMessage(quoteType) {
  return quoteType === "lead"
    ? "Quotation already exists for this lead. Use New Version from quotation details."
    : "Quotation already exists for this deal. Use New Version from quotation details.";
}

function getRoleName(user = {}) {
  return String(user?.role?.name || user?.role || "")
    .trim()
    .toLowerCase();
}

function isAdminUser(user = {}) {
  return getRoleName(user) === "admin";
}

function getUserScopedQuotationFilter(user = {}, baseFilter = {}) {
  if (isAdminUser(user)) return { ...baseFilter };
  return {
    ...baseFilter,
    createdBy: user?._id
  };
}

async function moveDealToStage(dealId, stage, actorId = null, options = {}) {
  if (!dealId) return null;
  const existingDeal = await Deal.findById(dealId).select("_id stage actualCloseDate lead_id").lean();
  if (!existingDeal) return null;

  const update = {
    stage,
    isActive: ![DEAL_WON_STAGE, "P6"].includes(stage)
  };
  if ([DEAL_WON_STAGE, "P6"].includes(stage) && !existingDeal.actualCloseDate) {
    update.actualCloseDate = new Date();
  }
  if (stage === DEAL_WON_STAGE && Object.prototype.hasOwnProperty.call(options, "dealValue")) {
    const dealValue = Number(options.dealValue);
    update.dealValue = Number.isFinite(dealValue) ? round2(Math.max(0, dealValue)) : 0;
  }

  const deal = await Deal.findByIdAndUpdate(
    dealId,
    { $set: update },
    { returnDocument: "after" }
  );

  if (String(existingDeal.stage || "") !== stage) {
    await DealStageHistory.create({
      dealId,
      stage,
      movedAt: new Date(),
      movedBy: actorId || null
    });
  }

  if (existingDeal.lead_id && stage === DEAL_WON_STAGE) {
    await Lead.updateOne(
      { _id: existingDeal.lead_id },
      { $set: { stage }, $unset: { status: "" } }
    );
  }

  return deal;
}

async function resolveClientForLead(lead, actorId, preferredClientId = null) {
  if (preferredClientId) {
    const preferred = await Client.findById(preferredClientId);
    if (preferred) return preferred;
  }

  const companyName = String(lead?.company_name || "").trim();
  const client = companyName
    ? await Client.findOne({
        name: new RegExp(`^${companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        is_deleted: { $ne: true }
      })
    : null;

  if (client) return client;

  let industryId = null;
  const rawIndustry = lead?.industry;
  if (rawIndustry && String(rawIndustry).match(/^[0-9a-fA-F]{24}$/)) {
    industryId = rawIndustry;
  } else if (rawIndustry) {
    const industryName = String(rawIndustry).trim();
    const industry = await Industry.findOneAndUpdate(
      { name: new RegExp(`^${industryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      {
        $set: { name: industryName, is_deleted: false, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true, returnDocument: "after" }
    );
    industryId = industry?._id || null;
  }

  return Client.create({
    name: companyName || `Converted Client ${String(lead?._id || "").slice(-6)}`,
    industry: industryId,
    Address: lead?.Address || "",
    employeeCount: lead?.employee_count || null,
    turnoverRange: lead?.turnover_range || "",
    website: lead?.website || "",
    source: lead?.source || null,
    deal_count: 0,
    createdBy: actorId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    is_deleted: false,
    location: lead?.location || null
  });
}

async function approveLeadQuotationAsWonDeal(quotation, actorId = null) {
  const lead = await Lead.findById(quotation.leadId);
  if (!lead) return null;
  const quotationRevenue = getQuotationRevenueAmount(quotation);

  if (lead.converted_deal_id) {
    const existingDeal = await moveDealToStage(
      lead.converted_deal_id,
      DEAL_WON_STAGE,
      actorId,
      { dealValue: quotationRevenue }
    );
    if (existingDeal) {
      await Lead.findByIdAndUpdate(lead._id, {
        $set: {
          stage: DEAL_WON_STAGE,
          converted_to_deal: true,
          is_existing_client: true,
          converted_deal_id: existingDeal._id,
          deal_name: existingDeal.deal_name || lead.deal_name || ""
        },
        $unset: { status: "" }
      });
      return existingDeal;
    }
  }

  const client = await resolveClientForLead(lead, actorId, quotation.clientId);
  const deal = await Deal.create({
    deal_name: lead.deal_name || `${lead.company_name || "Lead"} Deal`,
    client_id: client?._id || null,
    lead_id: lead._id,
    assignedTo: lead.assigned_to || quotation.assignedTo || null,
    assignedBy: actorId || null,
    stage: DEAL_WON_STAGE,
    dealValue: quotationRevenue,
    probability: 100,
    expectedCloseDate: new Date(),
    actualCloseDate: new Date(),
    isActive: false,
    is_deleted: false
  });

  await DealStageHistory.create({
    dealId: deal._id,
    stage: DEAL_WON_STAGE,
    movedAt: new Date(),
    movedBy: actorId || null
  });

  if (client?._id) {
    await Client.updateOne(
      { _id: client._id },
      { $inc: { deal_count: 1 }, $set: { updatedAt: new Date(), is_deleted: false } }
    );
  }

  await Lead.findByIdAndUpdate(lead._id, {
    $set: {
      stage: DEAL_WON_STAGE,
      converted_to_deal: true,
      is_existing_client: true,
      converted_deal_id: deal._id,
      deal_name: deal.deal_name
    },
    $unset: { status: "" }
  });

  return deal;
}

async function moveQuotationSourceToStage(quotation, stage, actorId = null) {
  const quoteType = inferQuoteType(quotation);
  if (quoteType === "deal" && quotation.dealId) {
    const options = stage === DEAL_WON_STAGE
      ? { dealValue: getQuotationRevenueAmount(quotation) }
      : {};
    return moveDealToStage(quotation.dealId, stage, actorId, options);
  }

  if (quoteType === "lead" && quotation.leadId) {
    if (stage === DEAL_WON_STAGE) {
      return approveLeadQuotationAsWonDeal(quotation, actorId);
    }
    await Lead.findByIdAndUpdate(quotation.leadId, {
      $set: { stage },
      $unset: { status: "" }
    });
  }

  return null;
}

function getTodayUtcStartDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function syncExpiredQuotations(extraFilter = {}) {
  const todayUtcStart = getTodayUtcStartDate();

  await Quotation.updateMany(
    {
      is_deleted: false,
      validUntil: {
        $ne: null,
        $lt: todayUtcStart
      },
      status: {
        $nin: ["expired", "rejected", "approved"]
      },
      ...extraFilter
    },
    {
      $set: {
        status: "expired",
        approvedBy: null,
        approvedAt: null
      }
    }
  );
}

function asNormalizedCategory(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveAutoClauseText({ industryId, productCategories = [] }) {
  const clauses = await QuotationClause.find({
    is_deleted: false
  })
    .sort({ priority: 1, createdAt: 1 })
    .lean();

  const normalizedCategories = new Set(
    (productCategories || []).map((category) => asNormalizedCategory(category)).filter(Boolean)
  );

  const matched = clauses.filter((clause) => {
    const scopeType = String(clause.scopeType || "").toLowerCase();

    if (scopeType === "global") return true;
    if (scopeType === "industry") {
      return industryId && String(clause.industryId || "") === String(industryId);
    }
    if (scopeType === "product_category") {
      return normalizedCategories.has(asNormalizedCategory(clause.productCategory));
    }

    return false;
  });

  const termsAndConditions = matched
    .map((clause) => String(clause.termsAndConditions || "").trim())
    .filter(Boolean)
    .join("\n\n");

  return { termsAndConditions };
}

async function resolveGlobalPaymentTerms() {
  const row = await QuotationPaymentTerms.findOne({ is_deleted: false })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("paymentTerms")
    .lean();

  return String(row?.paymentTerms || "").trim();
}

async function findBestClientContact(clientId) {
  if (!clientId) return null;

  const clientIdText = String(clientId);
  const clientIdRegex = new RegExp(`^${clientIdText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  // First preference: active contact rows for this client
  const activeContacts = await ClientContact.find({
    $or: [{ client_id: clientIdText }, { client_id: clientIdRegex }],
    is_active: { $ne: false }
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("name designation phone email linkedin is_deleted")
    .lean();

  let selected = activeContacts.find((row) => !row?.is_deleted) || activeContacts[0] || null;

  // Fallback: any contact row for this client
  if (!selected) {
    const anyContact = await ClientContact.findOne({
      $or: [{ client_id: clientIdText }, { client_id: clientIdRegex }]
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select("name designation phone email linkedin")
      .lean();

    selected = anyContact || null;
  }

  if (!selected) return null;

  return {
    _id: selected._id,
    name: selected.name || "",
    designation: selected.designation || "",
    phone: Array.isArray(selected.phone) ? selected.phone[0] || "" : (typeof selected.phone === 'string' ? selected.phone.split(",")[0].trim() : ""),
    email: Array.isArray(selected.email) ? selected.email[0] || "" : (typeof selected.email === 'string' ? selected.email.split(",")[0].trim() : ""),
    linkedin: selected.linkedin || ""
  };
}

exports.getQuotations = async (req, res) => {
  try {
    await syncExpiredQuotations();
    const quoteTypeFilter = req.query?.quoteType
      ? normalizeQuoteType(req.query.quoteType)
      : "";

    const quotations = await Quotation.find(
      getUserScopedQuotationFilter(req.user, {
        is_deleted: false
      })
    )
      .sort({ createdAt: -1 })
      .lean();

    if (!quotations.length) {
      return res.json([]);
    }

    const dealIds = [
      ...new Set(
        quotations
          .map((quote) => (quote.dealId ? String(quote.dealId) : ""))
          .filter(Boolean)
      )
    ];
    const leadIds = [
      ...new Set(
        quotations
          .map((quote) => (quote.leadId ? String(quote.leadId) : ""))
          .filter(Boolean)
      )
    ];
    const createdByIds = [
      ...new Set(
        quotations
          .map((quote) => (quote.createdBy ? String(quote.createdBy) : ""))
          .filter(Boolean)
      )
    ];

    const quotationIds = quotations.map((quote) => quote._id);

    const [deals, leads, itemCounts, creators] = await Promise.all([
      Deal.find({
        _id: { $in: dealIds }
      })
        .select("stage client_id lead_id")
        .lean(),
      Lead.find({
        _id: { $in: leadIds }
      })
        .select("company_name stage")
        .lean(),
      QuotationItem.aggregate([
        {
          $match: {
            quotationId: { $in: quotationIds },
            isActive: true
          }
        },
        {
          $group: {
            _id: "$quotationId",
            count: { $sum: 1 }
          }
        }
      ]),
      User.find({
        _id: { $in: createdByIds },
        is_deleted: { $ne: true }
      })
        .select("name email")
        .lean()
    ]);

    const clientIds = [
      ...new Set(
        quotations
          .map((quote) => (quote.clientId ? String(quote.clientId) : ""))
          .concat(
            deals.map((deal) => (deal.client_id ? String(deal.client_id) : ""))
          )
          .filter(Boolean)
      )
    ];

    const clients = await Client.find({
      _id: { $in: clientIds }
    })
      .select("name")
      .lean();

    const dealMap = new Map(deals.map((deal) => [String(deal._id), deal]));
    const leadMap = new Map(leads.map((lead) => [String(lead._id), lead]));
    const clientMap = new Map(clients.map((client) => [String(client._id), client.name]));
    const itemCountMap = new Map(itemCounts.map((entry) => [String(entry._id), entry.count]));
    const creatorMap = new Map(creators.map((user) => [String(user._id), user]));

    const response = quotations
      .map((quote) => {
        const quoteType = inferQuoteType(quote);
        if (quoteTypeFilter && quoteType !== quoteTypeFilter) return null;

        const deal = quote.dealId ? dealMap.get(String(quote.dealId)) : null;
        const leadId = quote.leadId || deal?.lead_id || null;
        const lead = leadId ? leadMap.get(String(leadId)) : null;
        const resolvedClientId = quote.clientId || deal?.client_id || null;
        const clientName = resolvedClientId
          ? clientMap.get(String(resolvedClientId)) || "Unknown Client"
          : lead?.company_name || "Unknown Client";
        const createdBy = quote.createdBy ? creatorMap.get(String(quote.createdBy)) : null;

        return {
        _id: quote._id,
        quoteNumber: quote.quoteNumber,
        quoteType,
        sourceId: quoteType === "lead" ? quote.leadId || null : quote.dealId || null,
        dealId: quote.dealId || null,
        leadId: quote.leadId || null,
        refCode: quoteType === "lead" ? lead?.stage || "-" : deal?.stage || "-",
        sourceLabel:
          quoteType === "lead"
            ? lead?.company_name || "Untitled Lead"
            : lead?.company_name || clientName || "Untitled Deal",
        clientName,
        itemsCount: itemCountMap.get(String(quote._id)) || 0,
        quoteDate: quote.quoteDate || null,
        subtotalAmount: quote.subtotalAmount || 0,
        taxAmount: quote.taxAmount || 0,
        discountAmount: quote.discountAmount || 0,
        grandTotal: quote.grandTotal || 0,
        validUntil: quote.validUntil || null,
        status: quote.status || "draft",
        version: quote.version || 1,
        createdByName: createdBy?.name || "Unknown",
        createdByEmail: createdBy?.email || "",
        createdAt: quote.createdAt || null
        };
      })
      .filter(Boolean);

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch quotations"
    });
  }
};

exports.getQuotationById = async (req, res) => {
  try {
    await syncExpiredQuotations({ _id: req.params.id });

    const quotation = await Quotation.findOne(
      getUserScopedQuotationFilter(req.user, {
        _id: req.params.id,
        is_deleted: false
      })
    ).lean();

    if (!quotation) {
      return res.status(404).json({
        message: "Quotation not found"
      });
    }

    const quoteType = inferQuoteType(quotation);
    const deal = quotation.dealId
      ? await Deal.findById(quotation.dealId).select("stage client_id lead_id").lean()
      : null;
    const leadId = quotation.leadId || deal?.lead_id || null;
    const sourceId = quoteType === "lead" ? leadId : quotation.dealId;

    if (!sourceId) {
      return res.status(400).json({
        message: "Quotation source is invalid"
      });
    }

    const resolvedClientId = quotation.clientId || deal?.client_id || null;
    const [lead, client, items, latestQuoteForSource, globalPaymentTerms, createdBy] = await Promise.all([
      leadId ? Lead.findById(leadId).select("company_name stage industry").lean() : null,
      resolvedClientId
        ? Client.findById(resolvedClientId).select("name website GST_no Address industry").lean()
        : null,
      QuotationItem.find({
        quotationId: quotation._id,
        isActive: true
      })
        .populate("productId", "name category price")
        .populate("taxId", "rate")
        .lean(),
      Quotation.findOne({
        ...getSourceFilter(quoteType, sourceId),
        is_deleted: false
      })
        .sort({ version: -1, createdAt: -1 })
        .select("_id status")
        .lean(),
      resolveGlobalPaymentTerms(),
      quotation.createdBy
        ? User.findById(quotation.createdBy).select("name email").lean()
        : null
    ]);

    const clientContact = await findBestClientContact(client?._id || resolvedClientId);

    const canCreateNewVersion = latestQuoteForSource
      ? VERSION_ALLOWED_PREVIOUS_STATUSES.includes(
          String(latestQuoteForSource.status || "").toLowerCase()
        )
      : true;

    const itemRows = items.map((item) => ({
      _id: item._id,
      productId: item.productId?._id || item.productId || null,
      productName: item.productId?.name || "Unknown Product",
      category: item.productId?.category || "",
      quantity: item.quantity || 0,
      unitPrice: item.unitPrice || 0,
      discountPercent: item.discountPercent || 0,
      taxPercent: item.taxPercent || 0,
      taxRate: item.taxId?.rate ?? item.taxPercent ?? 0,
      subtotal: item.subtotal || 0,
      tax: item.tax || 0,
      netTotal: item.netTotal || 0
    }));

    let resolvedTermsAndConditions = String(quotation.termsAndConditions || "").trim();
    if (!resolvedTermsAndConditions) {
      const fallbackClause = await resolveAutoClauseText({
        industryId: client?.industry || lead?.industry || null,
        productCategories: itemRows.map((row) => row.category || "")
      });
      resolvedTermsAndConditions = String(fallbackClause?.termsAndConditions || "").trim();
    }

    res.json({
      quotation: {
        _id: quotation._id,
        quoteNumber: quotation.quoteNumber,
        quoteType,
        dealId: quotation.dealId || null,
        leadId: quotation.leadId || null,
        clientId: resolvedClientId || null,
        status: quotation.status || "draft",
        canCreateNewVersion,
        isLatestVersion: latestQuoteForSource
          ? String(latestQuoteForSource._id) === String(quotation._id)
          : true,
        version: quotation.version || 1,
        quoteDate: quotation.quoteDate || null,
        validUntil: quotation.validUntil || null,
        currency: quotation.currency || "INR",
        notes: quotation.notes || "",
        termsAndConditions: resolvedTermsAndConditions || "",
        paymentTerms: globalPaymentTerms || quotation.paymentTerms || "",
        subtotalAmount: quotation.subtotalAmount || 0,
        taxAmount: quotation.taxAmount || 0,
        discountAmount: quotation.discountAmount || 0,
        grandTotal: quotation.grandTotal || 0,
        createdBy: createdBy
          ? {
              _id: createdBy._id,
              name: createdBy.name || "Unknown",
              email: createdBy.email || ""
            }
          : null,
        createdAt: quotation.createdAt || null,
        updatedAt: quotation.updatedAt || null
      },
      deal: deal
        ? {
            _id: deal._id,
            stage: deal.stage || "-"
          }
        : null,
      lead: lead
        ? {
            _id: lead._id,
            companyName: lead.company_name || "Untitled Lead",
            stage: lead.stage || "-"
          }
        : null,
      client: client
        ? {
            _id: client._id,
            name: client.name || "Unknown Client",
            website: client.website || "",
            GST_no: client.GST_no || "",
            Address: client.Address || "",
            contact: clientContact
          }
        : null,
      items: itemRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch quotation details"
    });
  }
};

exports.createQuotation = async (req, res) => {
  try {
    if (isAdminUser(req.user)) {
      return res.status(403).json({
        message: VIEW_ONLY_ADMIN_MESSAGE
      });
    }

    const {
      quoteType: requestedQuoteType,
      dealId,
      leadId,
      clientId: requestedClientId,
      baseQuotationId,
      quoteDate,
      validUntil,
      notes,
      termsAndConditions,
      discountAmount,
      currency,
      items
    } = req.body;
    const quoteType = normalizeQuoteType(
      requestedQuoteType || (leadId ? "lead" : "deal")
    );

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one line item is required"
      });
    }

    let sourceId = null;
    let resolvedDealId = null;
    let resolvedLeadId = null;
    let resolvedClientId = null;
    let assignedTo = null;
    let industryIdForClauses = null;

    if (quoteType === "deal") {
      if (!dealId) {
        return res.status(400).json({
          message: "Deal is required"
        });
      }

      const deal = await Deal.findById(dealId).lean();
      if (!deal) {
        return res.status(404).json({
          message: "Deal not found"
        });
      }
      if (!deal.client_id) {
        return res.status(400).json({
          message: "Selected deal is not linked to any client"
        });
      }

      const dealClient = await Client.findById(deal.client_id)
        .select("industry")
        .lean();

      sourceId = deal._id;
      resolvedDealId = deal._id;
      resolvedClientId = deal.client_id;
      assignedTo = deal.assignedTo || null;
      industryIdForClauses = dealClient?.industry || null;
    } else {
      if (!leadId) {
        return res.status(400).json({
          message: "Lead is required"
        });
      }

      const lead = await Lead.findById(leadId)
        .select("assigned_to industry")
        .lean();
      if (!lead) {
        return res.status(404).json({
          message: "Lead not found"
        });
      }

      const selectedClient = requestedClientId
        ? await Client.findById(requestedClientId)
            .select("industry")
            .lean()
        : null;
      if (requestedClientId && !selectedClient) {
        return res.status(404).json({
          message: "Selected client not found"
        });
      }

      sourceId = lead._id;
      resolvedLeadId = lead._id;
      resolvedClientId = selectedClient?._id || null;
      assignedTo = lead.assigned_to || null;
      industryIdForClauses = selectedClient?.industry || lead?.industry || null;
    }

    const sourceFilter = getSourceFilter(quoteType, sourceId);
    await syncExpiredQuotations(sourceFilter);

    const latestQuoteForSource = await Quotation.findOne({
      ...sourceFilter,
      is_deleted: false
    })
      .sort({ version: -1, createdAt: -1 })
      .select("_id version status")
      .lean();

    if (latestQuoteForSource && !baseQuotationId) {
      return res.status(400).json({
        message: getDuplicateMessage(quoteType)
      });
    }

    if (latestQuoteForSource && baseQuotationId) {
      const baseQuotation = await Quotation.findOne({
        _id: baseQuotationId,
        ...sourceFilter,
        is_deleted: false
      })
        .select("_id")
        .lean();

      if (!baseQuotation) {
        return res.status(400).json({
          message: "Invalid base quotation selected for version creation"
        });
      }
    }

    if (
      latestQuoteForSource &&
      !VERSION_ALLOWED_PREVIOUS_STATUSES.includes(
        String(latestQuoteForSource.status || "").toLowerCase()
      )
    ) {
      return res.status(400).json({
        message:
          "New version can only be created when the latest quotation is expired or rejected"
      });
    }

    const version = (latestQuoteForSource?.version || 0) + 1;
    const finalQuoteDate = quoteDate ? new Date(quoteDate) : new Date();
    const quoteNumber = buildQuoteNumber(sourceId, finalQuoteDate, version, quoteType);

    const productIds = [
      ...new Set(
        items
          .map((item) => item.productId)
          .filter(Boolean)
      )
    ];

    if (!productIds.length) {
      return res.status(400).json({
        message: "Every line item must have a product"
      });
    }

    const products = await Product.find({
      _id: { $in: productIds },
      is_deleted: false
    })
      .select("name category price taxPercent taxId")
      .lean();

    const productMap = new Map(products.map((product) => [String(product._id), product]));

    if (productMap.size !== productIds.length) {
      return res.status(400).json({
        message: "One or more selected products no longer exist"
      });
    }

    const taxIds = [
      ...new Set(
        items
          .map((item) => item.taxId)
          .concat(products.map((product) => product.taxId))
          .filter(Boolean)
          .map((id) => String(id))
      )
    ];

    const taxes = await Tax.find({
      _id: { $in: taxIds },
      is_deleted: false
    })
      .select("rate")
      .lean();

    const taxMap = new Map(taxes.map((tax) => [String(tax._id), tax]));

    const requestedTaxIds = [
      ...new Set(
        items
          .map((item) => item.taxId)
          .filter(Boolean)
          .map((id) => String(id))
      )
    ];

    const missingRequestedTaxId = requestedTaxIds.find((id) => !taxMap.has(id));
    if (missingRequestedTaxId) {
      return res.status(400).json({
        message: "One or more selected taxes no longer exist"
      });
    }

    let subtotalAmount = 0;
    let taxAmount = 0;
    const selectedProductCategories = products.map((product) => product.category || "");

    const normalizedItems = items.map((item) => {
      const product = productMap.get(String(item.productId));
      const selectedTaxId = item.taxId
        ? String(item.taxId)
        : product.taxId
          ? String(product.taxId)
          : null;

      const quantity = Math.max(1, Math.round(parseNumber(item.quantity, 1)));
      const unitPrice = Math.max(0, parseNumber(item.unitPrice, product.price || 0));
      const discountPercent = clamp(parseNumber(item.discountPercent, 0), 0, MAX_PERCENT);
      const taxPercent = selectedTaxId
        ? clamp(parseNumber(taxMap.get(selectedTaxId)?.rate, 0), 0, MAX_PERCENT)
        : 0;

      const grossSubtotal = quantity * unitPrice;
      const discountValue = grossSubtotal * (discountPercent / 100);
      const taxableSubtotal = grossSubtotal - discountValue;
      const tax = taxableSubtotal * (taxPercent / 100);
      const netTotal = taxableSubtotal + tax;

      subtotalAmount += taxableSubtotal;
      taxAmount += tax;

      return {
        productId: item.productId,
        quantity,
        unitPrice: round2(unitPrice),
        discountPercent: round2(discountPercent),
        taxPercent: round2(taxPercent),
        taxId: selectedTaxId || null,
        subtotal: round2(taxableSubtotal),
        tax: round2(tax),
        netTotal: round2(netTotal)
      };
    });

    const normalizedDiscountAmount = Math.max(0, parseNumber(discountAmount, 0));
    const grandTotal = Math.max(0, round2(subtotalAmount + taxAmount - normalizedDiscountAmount));

    const [autoClauseText, globalPaymentTerms] = await Promise.all([
      resolveAutoClauseText({
        industryId: industryIdForClauses || null,
        productCategories: selectedProductCategories
      }),
      resolveGlobalPaymentTerms()
    ]);

    const quotation = await Quotation.create({
      quoteNumber,
      quoteType,
      dealId: resolvedDealId,
      leadId: resolvedLeadId,
      clientId: resolvedClientId || null,
      createdBy: req.user._id,
      assignedTo: assignedTo || null,
      quoteDate: finalQuoteDate,
      validUntil: validUntil ? new Date(validUntil) : null,
      subtotalAmount: round2(subtotalAmount),
      taxAmount: round2(taxAmount),
      discountAmount: round2(normalizedDiscountAmount),
      grandTotal,
      currency: currency || "INR",
      status: "draft",
      version,
      notes: notes || "",
      termsAndConditions:
        String(termsAndConditions || "").trim() || autoClauseText.termsAndConditions || "",
      paymentTerms: globalPaymentTerms || "",
      isActive: true,
      is_deleted: false
    });

    await QuotationItem.insertMany(
      normalizedItems.map((item) => ({
        quotationId: quotation._id,
        ...item,
        isActive: true
      }))
    );

    await moveQuotationSourceToStage(quotation, QUOTATION_CREATED_STAGE, req.user?._id || null);
    if (quoteType === "lead" && resolvedLeadId) {
      await Lead.updateOne(
        { _id: resolvedLeadId },
        { $set: { stage: QUOTATION_CREATED_STAGE }, $unset: { status: "" } }
      );
    }

    res.status(201).json({
      _id: quotation._id,
      quoteNumber: quotation.quoteNumber,
      quoteType: quotation.quoteType || quoteType,
      dealId: quotation.dealId || null,
      leadId: quotation.leadId || null,
      version: quotation.version,
      grandTotal: quotation.grandTotal
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create quotation"
    });
  }
};

exports.updateQuotationStatus = async (req, res) => {
  try {
    if (isAdminUser(req.user)) {
      return res.status(403).json({
        message: VIEW_ONLY_ADMIN_MESSAGE
      });
    }

    const nextStatus = String(req.body?.status || "")
      .trim()
      .toLowerCase();

    if (!nextStatus || !QUOTATION_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        message: "Invalid quotation status"
      });
    }

    await syncExpiredQuotations({ _id: req.params.id });

    const currentQuotation = await Quotation.findOne(
      getUserScopedQuotationFilter(req.user, {
        _id: req.params.id,
        is_deleted: false
      })
    )
      .select("_id dealId leadId clientId assignedTo quoteType version status")
      .lean();

    if (!currentQuotation) {
      return res.status(404).json({
        message: "Quotation not found"
      });
    }

    if (["approved", "rejected"].includes(String(currentQuotation.status || "").toLowerCase())) {
      if (nextStatus === "approved" && String(currentQuotation.status || "").toLowerCase() === "approved") {
        await moveQuotationSourceToStage(currentQuotation, DEAL_WON_STAGE, req.user?._id || null);
        return res.json({
          _id: currentQuotation._id,
          status: currentQuotation.status,
          version: currentQuotation.version,
          updatedAt: currentQuotation.updatedAt
        });
      }
      return res.status(400).json({
        message: "Approved or rejected quotations cannot be changed"
      });
    }

    const quoteType = inferQuoteType(currentQuotation);
    const sourceId = quoteType === "lead" ? currentQuotation.leadId : currentQuotation.dealId;

    if (!sourceId) {
      return res.status(400).json({
        message: "Quotation source is invalid"
      });
    }

    const latestQuotationForSource = await Quotation.findOne({
      ...getSourceFilter(quoteType, sourceId),
      is_deleted: false
    })
      .sort({ version: -1, createdAt: -1 })
      .select("_id")
      .lean();

    if (
      latestQuotationForSource &&
      String(latestQuotationForSource._id) !== String(currentQuotation._id)
    ) {
      return res.status(400).json({
        message: "Previous quotation status is locked; only the latest version can be updated"
      });
    }

    const updatePayload = { status: nextStatus };

    if (nextStatus === "approved") {
      updatePayload.approvedBy = req.user?._id || null;
      updatePayload.approvedAt = new Date();
    } else {
      updatePayload.approvedBy = null;
      updatePayload.approvedAt = null;
    }

    const quotation = await Quotation.findOneAndUpdate(
      getUserScopedQuotationFilter(req.user, { _id: req.params.id, is_deleted: false }),
      {
        $set: updatePayload
      },
      {
        returnDocument: "after"
      }
    ).select("_id status version updatedAt dealId leadId clientId assignedTo quoteType subtotalAmount taxAmount grandTotal");

    if (!quotation) {
      return res.status(404).json({
        message: "Quotation not found"
      });
    }

    if (nextStatus === "approved") {
      await moveQuotationSourceToStage(quotation, DEAL_WON_STAGE, req.user?._id || null);
    }

    res.json({
      _id: quotation._id,
      status: quotation.status,
      version: quotation.version,
      updatedAt: quotation.updatedAt
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update quotation status"
    });
  }
};

exports.deleteQuotation = async (req, res) => {
  try {
    if (isAdminUser(req.user)) {
      return res.status(403).json({
        message: VIEW_ONLY_ADMIN_MESSAGE
      });
    }

    const quotation = await Quotation.findOneAndUpdate(
      getUserScopedQuotationFilter(req.user, {
        _id: req.params.id,
        is_deleted: false
      }),
      {
        is_deleted: true,
        isActive: false
      },
      {
        returnDocument: "after"
      }
    );

    if (!quotation) {
      return res.status(404).json({
        message: "Quotation not found"
      });
    }

    await QuotationItem.updateMany({ quotationId: quotation._id }, { isActive: false });

    res.json({
      message: "Quotation deleted successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to delete quotation"
    });
  }
};
