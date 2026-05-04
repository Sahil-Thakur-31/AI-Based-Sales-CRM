const QuotationClause = require("../models/quotationClauses");
const QuotationPaymentTerms = require("../models/quotationPaymentTerms");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeScopeType(value) {
  const scopeType = normalizeText(value).toLowerCase();
  if (["global", "industry", "product_category"].includes(scopeType)) {
    return scopeType;
  }
  return "global";
}

function mapClause(row) {
  return {
    _id: row._id,
    scopeType: row.scopeType || "global",
    industryId: row.industryId?._id || row.industryId || null,
    industryName: row.industryId?.name || "",
    productCategory: row.productCategory || "",
    termsAndConditions: row.termsAndConditions || "",
    priority: Number(row.priority || 100),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function validatePayload(payload) {
  const scopeType = normalizeScopeType(payload.scopeType);
  const industryId = payload.industryId || null;
  const productCategory = normalizeText(payload.productCategory);
  const termsAndConditions = normalizeText(payload.termsAndConditions);
  const priority = Number.isFinite(Number(payload.priority))
    ? Number(payload.priority)
    : 100;

  if (!termsAndConditions) {
    return { error: "Terms and conditions is required" };
  }

  if (scopeType === "industry" && !industryId) {
    return { error: "Industry is required for industry scope" };
  }

  if (scopeType === "product_category" && !productCategory) {
    return { error: "Product category is required for product category scope" };
  }

  return {
    value: {
      scopeType,
      industryId: scopeType === "industry" ? industryId : null,
      productCategory: scopeType === "product_category" ? productCategory : "",
      termsAndConditions,
      priority
    }
  };
}

function mapPaymentTerms(row) {
  return {
    _id: row?._id || null,
    paymentTerms: row?.paymentTerms || "",
    updatedAt: row?.updatedAt || null
  };
}

exports.getQuotationClauses = async (req, res) => {
  try {
    const status = String(req.query?.status || "active").trim().toLowerCase();
    const filter = {};

    if (status === "deleted") {
      filter.is_deleted = true;
    } else if (status !== "all") {
      filter.is_deleted = false;
    }

    const rows = await QuotationClause.find(filter)
      .populate("industryId", "name")
      .sort({ priority: 1, createdAt: -1 })
      .lean();

    res.json(rows.map(mapClause));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch quotation clauses" });
  }
};

exports.createQuotationClause = async (req, res) => {
  try {
    const { error, value } = validatePayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const clause = await QuotationClause.create({
      ...value,
      is_deleted: false
    });

    const populated = await QuotationClause.findById(clause._id)
      .populate("industryId", "name")
      .lean();
    res.status(201).json(mapClause(populated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create quotation clause" });
  }
};

exports.updateQuotationClause = async (req, res) => {
  try {
    const { error, value } = validatePayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const updated = await QuotationClause.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      {
        $set: {
          ...value,
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    )
      .populate("industryId", "name")
      .lean();

    if (!updated) {
      return res.status(404).json({ message: "Quotation clause not found" });
    }

    res.json(mapClause(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update quotation clause" });
  }
};

exports.deleteQuotationClause = async (req, res) => {
  try {
    const deleted = await QuotationClause.findByIdAndUpdate(
      req.params.id,
      {
        is_deleted: true,
        updatedAt: new Date()
      },
      { returnDocument: "after" }
    );

    if (!deleted) {
      return res.status(404).json({ message: "Quotation clause not found" });
    }

    res.json({ message: "Quotation clause deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete quotation clause" });
  }
};

exports.restoreQuotationClause = async (req, res) => {
  try {
    const restored = await QuotationClause.findByIdAndUpdate(
      req.params.id,
      {
        is_deleted: false,
        updatedAt: new Date()
      },
      { returnDocument: "after" }
    );

    if (!restored) {
      return res.status(404).json({ message: "Quotation clause not found" });
    }

    res.json({ message: "Quotation clause restored successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to restore quotation clause" });
  }
};

exports.getPaymentTerms = async (_req, res) => {
  try {
    const row = await QuotationPaymentTerms.findOne({ is_deleted: false })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    res.json(mapPaymentTerms(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch payment terms" });
  }
};

exports.upsertPaymentTerms = async (req, res) => {
  try {
    const paymentTerms = normalizeText(req.body?.paymentTerms);

    const existing = await QuotationPaymentTerms.findOne({ is_deleted: false })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select("_id")
      .lean();

    let row;
    if (existing?._id) {
      row = await QuotationPaymentTerms.findOneAndUpdate(
        { _id: existing._id, is_deleted: false },
        {
          $set: {
            paymentTerms,
            updatedBy: req.user?._id || null,
            updatedAt: new Date()
          }
        },
        { returnDocument: "after" }
      ).lean();
    } else {
      row = await QuotationPaymentTerms.create({
        paymentTerms,
        is_deleted: false,
        updatedBy: req.user?._id || null
      });
      row = row.toObject();
    }

    await QuotationPaymentTerms.updateMany(
      {
        _id: { $ne: row._id },
        is_deleted: false
      },
      {
        $set: {
          is_deleted: true,
          updatedAt: new Date()
        }
      }
    );

    res.json(mapPaymentTerms(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save payment terms" });
  }
};
