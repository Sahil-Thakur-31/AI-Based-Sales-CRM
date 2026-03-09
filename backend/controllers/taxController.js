const Tax = require("../models/taxes");

function parseRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return parsed;
}

exports.getTaxes = async (req, res) => {
  try {
    const status = String(req.query?.status || "active").trim().toLowerCase();
    const filter = {};

    if (status === "deleted") {
      filter.is_deleted = true;
    } else if (status !== "all") {
      filter.is_deleted = false;
    }

    const data = await Tax.find(filter).sort({ rate: 1 });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch taxes" });
  }
};

exports.createTax = async (req, res) => {
  try {
    const rate = parseRate(req.body.rate);
    if (rate === null) {
      return res.status(400).json({ message: "Rate must be between 0 and 100" });
    }

    const existing = await Tax.findOne({ rate, is_deleted: false });
    if (existing) {
      return res.status(400).json({ message: "Tax rate already exists" });
    }

    const tax = await Tax.create({
      rate,
      createdBy: req.user?._id || null,
      is_deleted: false
    });

    res.status(201).json(tax);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create tax" });
  }
};

exports.updateTax = async (req, res) => {
  try {
    const rate = parseRate(req.body.rate);
    if (rate === null) {
      return res.status(400).json({ message: "Rate must be between 0 and 100" });
    }

    const duplicate = await Tax.findOne({
      _id: { $ne: req.params.id },
      rate,
      is_deleted: false
    });

    if (duplicate) {
      return res.status(400).json({ message: "Tax rate already exists" });
    }

    const tax = await Tax.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { $set: { rate, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!tax) {
      return res.status(404).json({ message: "Tax not found" });
    }

    res.json(tax);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update tax" });
  }
};

exports.deleteTax = async (req, res) => {
  try {
    const tax = await Tax.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!tax) {
      return res.status(404).json({ message: "Tax not found" });
    }

    res.json({ message: "Tax deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
};

exports.activateTax = async (req, res) => {
  try {
    const tax = await Tax.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!tax) {
      return res.status(404).json({ message: "Tax not found" });
    }

    res.json({ message: "Tax restored successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Restore failed" });
  }
};
