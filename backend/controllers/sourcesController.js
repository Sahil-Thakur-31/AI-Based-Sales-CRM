const Source = require("../models/sources");

const SYSTEM_SOURCES = [
  { name: "Reference" },
  { name: "Event & Expo" },
];

function normalizeName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isSystemSourceName(name = "") {
  const normalized = normalizeName(name);
  return SYSTEM_SOURCES.some((source) => normalizeName(source.name) === normalized);
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureSystemSources() {
  for (const source of SYSTEM_SOURCES) {
    const existing = await Source.findOne({
      name: { $regex: `^${escapeRegExp(source.name)}$`, $options: "i" },
    });

    if (!existing) {
      await Source.create({
        name: source.name,
        url: "",
        is_deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      continue;
    }

    const updates = {};
    if (existing.name !== source.name) updates.name = source.name;
    if (String(existing.url || "").trim()) updates.url = "";
    if (existing.is_deleted) updates.is_deleted = false;
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await Source.updateOne({ _id: existing._id }, { $set: updates });
    }
  }
}

exports.getSources = async (req, res) => {
  try {
    await ensureSystemSources();

    const status = String(req.query?.status || "active").trim().toLowerCase();
    const filter = {};

    if (status === "deleted") {
      filter.is_deleted = true;
    } else if (status === "all") {
      // no is_deleted filter
    } else {
      filter.is_deleted = false;
    }

    const data = await Source.find(filter)
      .populate("createdBy", "name")
      .sort({ name: 1 });

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch sources" });
  }
};

exports.createSource = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const url = String(req.body?.url || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Source name is required" });
    }
    if (!url) {
      return res.status(400).json({ message: "Source URL is required" });
    }
    if (isSystemSourceName(name)) {
      return res.status(409).json({
        message: "Reference and Event & Expo are system sources and already available",
      });
    }

    const duplicate = await Source.findOne({
      name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
      is_deleted: false
    });
    if (duplicate) {
      return res.status(409).json({ message: "Source already exists" });
    }

    const source = await Source.create({
      name,
      url,
      createdBy: req.user?._id || null,
      createdAt: new Date(),
      is_deleted: false
    });

    return res.status(201).json(source);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Create failed" });
  }
};

exports.updateSource = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const url = String(req.body?.url || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Source name is required" });
    }
    if (!url) {
      return res.status(400).json({ message: "Source URL is required" });
    }

    const existing = await Source.findById(req.params.id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ message: "Source not found or deleted" });
    }

    if (isSystemSourceName(existing.name)) {
      return res.status(403).json({
        message: "Reference and Event & Expo are system sources and cannot be edited",
      });
    }
    if (isSystemSourceName(name)) {
      return res.status(409).json({
        message: "Reference and Event & Expo are reserved system source names",
      });
    }

    const duplicate = await Source.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
      is_deleted: false
    });
    if (duplicate) {
      return res.status(409).json({ message: "Source already exists" });
    }

    const source = await Source.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { name, url, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!source) {
      return res.status(404).json({ message: "Source not found or deleted" });
    }

    return res.json(source);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Update failed" });
  }
};

exports.deleteSource = async (req, res) => {
  try {
    const existing = await Source.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Source not found" });
    }
    if (isSystemSourceName(existing.name)) {
      return res.status(403).json({
        message: "Reference and Event & Expo are system sources and cannot be deleted",
      });
    }

    const source = await Source.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }

    return res.json({ message: "Source deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Delete failed" });
  }
};

exports.activateSource = async (req, res) => {
  try {
    const existing = await Source.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Source not found" });
    }
    if (isSystemSourceName(existing.name)) {
      const updates = {
        is_deleted: false,
        url: "",
        updatedAt: new Date(),
      };
      await Source.updateOne({ _id: existing._id }, { $set: updates });
      return res.json({ message: "Source activated" });
    }

    const source = await Source.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!source) {
      return res.status(404).json({ message: "Source not found" });
    }

    return res.json({ message: "Source activated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Activate failed" });
  }
};
