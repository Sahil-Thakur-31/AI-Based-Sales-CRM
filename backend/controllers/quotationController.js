const Quotation = require("../models/quatations");
const QuotationItem = require("../models/quatation_item");
const Deal = require("../models/deals");
const Client = require("../models/client");
const Product = require("../models/products");
const Tax = require("../models/taxes");

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

function buildQuoteNumber(dealId, quoteDate, version) {

  const year = new Date(quoteDate || Date.now()).getFullYear();
  const dealToken = String(dealId).slice(-6).toUpperCase();
  const versionToken = String(version).padStart(2, "0");

  return `QT-${year}-${dealToken}-${versionToken}`;

}

exports.getQuotations = async (req, res) => {

  try {

    const quotations = await Quotation.find({
      is_deleted: false
    })
    .sort({ createdAt: -1 })
    .lean();

    if (!quotations.length) {
      return res.json([]);
    }

    const dealIds = [
      ...new Set(
        quotations
        .map((quote) => quote.dealId ? String(quote.dealId) : "")
        .filter(Boolean)
      )
    ];

    const quotationIds = quotations.map((quote) => quote._id);

    const [deals, itemCounts] = await Promise.all([

      Deal.find({
        _id: { $in: dealIds }
      })
      .select("stage client_id")
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
      ])

    ]);

    const clientIds = [
      ...new Set(
        deals
        .map((deal) => deal.client_id ? String(deal.client_id) : "")
        .filter(Boolean)
      )
    ];

    const clients = await Client.find({
      _id: { $in: clientIds }
    })
    .select("name")
    .lean();

    const dealMap = new Map(
      deals.map((deal) => [String(deal._id), deal])
    );

    const clientMap = new Map(
      clients.map((client) => [String(client._id), client.name])
    );

    const itemCountMap = new Map(
      itemCounts.map((entry) => [String(entry._id), entry.count])
    );

    const response = quotations.map((quote) => {

      const deal = dealMap.get(String(quote.dealId));
      const clientName = deal?.client_id
        ? (clientMap.get(String(deal.client_id)) || "Unknown Client")
        : "Unknown Client";

      return {
        _id: quote._id,
        quoteNumber: quote.quoteNumber,
        dealId: quote.dealId,
        refCode: deal?.stage || "-",
        clientName,
        itemsCount: itemCountMap.get(String(quote._id)) || 0,
        subtotalAmount: quote.subtotalAmount || 0,
        taxAmount: quote.taxAmount || 0,
        discountAmount: quote.discountAmount || 0,
        grandTotal: quote.grandTotal || 0,
        validUntil: quote.validUntil || null,
        status: quote.status || "draft",
        version: quote.version || 1
      };

    });

    res.json(response);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch quotations"
    });

  }

};

exports.createQuotation = async (req, res) => {

  try {

    const {
      dealId,
      quoteDate,
      validUntil,
      notes,
      discountAmount,
      currency,
      items
    } = req.body;

    if (!dealId) {
      return res.status(400).json({
        message: "Deal is required"
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one line item is required"
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

    const latestQuoteForDeal = await Quotation.findOne({
      dealId
    })
    .sort({ version: -1 })
    .select("version")
    .lean();

    const version = (latestQuoteForDeal?.version || 0) + 1;
    const finalQuoteDate = quoteDate ? new Date(quoteDate) : new Date();
    const quoteNumber = buildQuoteNumber(dealId, finalQuoteDate, version);

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
    .select("name price taxPercent taxId")
    .lean();

    const productMap = new Map(
      products.map((product) => [String(product._id), product])
    );

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

    const taxMap = new Map(
      taxes.map((tax) => [String(tax._id), tax])
    );

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

    const normalizedItems = items.map((item) => {

      const product = productMap.get(String(item.productId));
      const selectedTaxId = item.taxId
        ? String(item.taxId)
        : (product.taxId ? String(product.taxId) : null);

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
    const grandTotal = Math.max(
      0,
      round2(subtotalAmount + taxAmount - normalizedDiscountAmount)
    );

    const quotation = await Quotation.create({
      quoteNumber,
      dealId,
      clientId: deal.client_id,
      createdBy: req.user._id,
      assignedTo: deal.assignedTo || null,
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

    res.status(201).json({
      _id: quotation._id,
      quoteNumber: quotation.quoteNumber,
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

    const nextStatus = String(req.body?.status || "")
      .trim()
      .toLowerCase();

    if (!nextStatus || !QUOTATION_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        message: "Invalid quotation status"
      });
    }

    const updatePayload = {
      status: nextStatus
    };

    if (nextStatus === "approved") {
      updatePayload.approvedBy = req.user?._id || null;
      updatePayload.approvedAt = new Date();
    } else {
      updatePayload.approvedBy = null;
      updatePayload.approvedAt = null;
    }

    const quotation = await Quotation.findOneAndUpdate(
      {
        _id: req.params.id,
        is_deleted: false
      },
      {
        $set: updatePayload
      },
      {
        new: true
      }
    )
    .select("_id status version updatedAt");

    if (!quotation) {
      return res.status(404).json({
        message: "Quotation not found"
      });
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

    const quotation = await Quotation.findOneAndUpdate(

      {
        _id: req.params.id,
        is_deleted: false
      },

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

    await QuotationItem.updateMany(
      { quotationId: quotation._id },
      { isActive: false }
    );

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
