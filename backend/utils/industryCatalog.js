const mongoose = require("mongoose");
const Industry = require("../models/industries");
const { normalizeIndustry } = require("./leadNormalization");

function cleanIndustryName(value) {
  return normalizeIndustry(value);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findIndustryByCanonicalName(name, options = {}) {
  const canonicalName = cleanIndustryName(name);
  if (!canonicalName) return null;

  const filter = {
    name: new RegExp(`^${escapeRegExp(canonicalName)}$`, "i"),
  };

  if (options.includeDeleted === false) {
    filter.is_deleted = false;
  }

  if (options.excludeId && mongoose.Types.ObjectId.isValid(String(options.excludeId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(options.excludeId)) };
  }

  return Industry.findOne(filter).sort({ is_deleted: 1, createdAt: 1, _id: 1 });
}

async function resolveIndustryDocument(value, options = {}) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const createIfMissing = options.createIfMissing === true;
  const reactivateIfDeleted = options.reactivateIfDeleted !== false;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    const byId = await Industry.findById(raw);
    if (byId) {
      const canonicalName = cleanIndustryName(byId.name);
      let changed = false;
      if (canonicalName && byId.name !== canonicalName) {
        byId.name = canonicalName;
        changed = true;
      }
      if (byId.is_deleted && reactivateIfDeleted) {
        byId.is_deleted = false;
        changed = true;
      }
      if (changed) {
        byId.updatedAt = new Date();
        await byId.save();
      }
      return byId;
    }
  }

  const canonicalName = cleanIndustryName(raw);
  if (!canonicalName) return null;

  const existing = await findIndustryByCanonicalName(canonicalName, { includeDeleted: true });
  if (existing) {
    let changed = false;
    if (existing.name !== canonicalName) {
      existing.name = canonicalName;
      changed = true;
    }
    if (existing.is_deleted && reactivateIfDeleted) {
      existing.is_deleted = false;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date();
      await existing.save();
    }
    return existing;
  }

  if (!createIfMissing) return null;

  return Industry.create({
    name: canonicalName,
    is_deleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

module.exports = {
  cleanIndustryName,
  findIndustryByCanonicalName,
  resolveIndustryDocument,
};
