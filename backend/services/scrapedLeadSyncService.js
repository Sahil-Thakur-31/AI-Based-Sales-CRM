const mongoose = require("mongoose");
const AiGeneratedLead = require("../models/ai_generated_leads");
const AiLeadContact = require("../models/ai_lead_contacts");
const Location = require("../models/location");
const Source = require("../models/sources");
const { normalizeEmail, normalizeIndustry } = require("../utils/leadNormalization");

const getScrapedLeadCollectionName = () => process.env.LEAD_SCRAPER_COLLECTION_NAME || "scraped_leads";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleFromSourceKey(value) {
  const text = clean(value).replace(/_/g, " ");
  if (!text) return "Lead Scraper";
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeWebsite(value) {
  return clean(value).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function compactPhone(value) {
  const digits = clean(value).replace(/\D/g, "").slice(-15);
  return digits.length >= 10 ? digits : "";
}

function firstFilled(...values) {
  return values.map(clean).find(Boolean) || "";
}

async function resolveSourceId(sourceKey) {
  const name = titleFromSourceKey(sourceKey);
  const now = new Date();
  const source = await Source.findOneAndUpdate(
    { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    {
      $setOnInsert: {
        name,
        createdAt: now,
      },
      $set: {
        updatedAt: now,
        is_deleted: false,
      },
    },
    { new: true, upsert: true }
  ).lean();
  return source?._id || null;
}

async function resolveLocationId(row) {
  const city = clean(row.city);
  const state = clean(row.state);
  const country = clean(row.country);
  const pincode = clean(row.pincode);
  if (!city && !state && !country && !pincode) return null;

  const now = new Date();
  const location = await Location.findOneAndUpdate(
    {
      city,
      state,
      country,
      pincode,
    },
    {
      $setOnInsert: {
        city,
        state,
        State: state,
        country,
        pincode,
        createdAt: now,
      },
      $set: {
        updatedAt: now,
      },
    },
    { new: true, upsert: true }
  ).lean();
  return location?._id || null;
}

function buildEmployeeRange(row) {
  const hint = row.companySizeSignals?.employeeCountHint;
  return clean(hint);
}

function buildTurnoverRange(row) {
  return firstFilled(row.zauba?.authorizedCapital, row.zauba?.paidUpCapital);
}

function collectContacts(row) {
  const contacts = [];

  const decisionMakers = Array.isArray(row.decisionMakerContacts) ? row.decisionMakerContacts : [];
  for (const contact of decisionMakers) {
    contacts.push({
      name: clean(contact.name),
      designation: clean(contact.role || contact.designation),
      email: normalizeEmail(contact.email),
      phone: compactPhone(contact.phone),
      linkedin: clean(contact.linkedin),
    });
  }

  const linkedInPeople = Array.isArray(row.linkedinDecisionMakers) ? row.linkedinDecisionMakers : [];
  for (const person of linkedInPeople) {
    contacts.push({
      name: clean(person.name),
      designation: clean(person.role || person.title),
      email: "",
      phone: "",
      linkedin: clean(person.linkedin || person.url),
    });
  }

  const companyContacts = row.companyContacts && typeof row.companyContacts === "object" ? row.companyContacts : {};
  const genericEmail = Array.isArray(companyContacts.emails) ? companyContacts.emails[0] : row.email;
  const genericPhone = Array.isArray(companyContacts.phones) ? companyContacts.phones[0] : row.phone;
  if (clean(genericEmail) || clean(genericPhone)) {
    contacts.push({
      name: "Company Contact",
      designation: "",
      email: normalizeEmail(genericEmail),
      phone: compactPhone(genericPhone),
      linkedin: "",
    });
  }

  const seen = new Set();
  return contacts.filter((contact) => {
    const key = [contact.name, contact.email, contact.phone, contact.linkedin].join("|").toLowerCase();
    if (!contact.name && !contact.email && !contact.phone && !contact.linkedin) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

async function syncScrapedLeads({ limit = 0 } = {}) {
  if (!mongoose.connection?.db) {
    throw new Error("MongoDB connection is not ready.");
  }

  const collection = mongoose.connection.db.collection(getScrapedLeadCollectionName());
  const query = { is_deleted: { $ne: true } };
  let cursor = collection.find(query).sort({ updatedAt: -1, createdAt: -1 });
  if (Number(limit) > 0) {
    cursor = cursor.limit(Number(limit));
  }

  const scrapedLeads = await cursor.toArray();
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let contactCount = 0;

  for (const row of scrapedLeads) {
    const companyName = clean(row.name);
    if (!companyName) {
      skippedCount += 1;
      continue;
    }

    const sourceKey = clean(row.source).toLowerCase();
    const [sourceId, locationId] = await Promise.all([
      resolveSourceId(sourceKey),
      resolveLocationId(row),
    ]);

    const website = normalizeWebsite(row.website);
    const filterOptions = [{ scraped_lead_id: row._id }];
    if (website) filterOptions.push({ website });
    if (companyName && clean(row.address)) {
      filterOptions.push({ company_name: companyName, Address: clean(row.address) });
    }
    if (companyName) {
      filterOptions.push({ company_name: companyName });
    }

    const existing = await AiGeneratedLead.findOne({ $or: filterOptions })
      .select("_id status is_deleted industry")
      .lean();

    if (existing?.status === "imported" || existing?.is_deleted === true) {
      skippedCount += 1;
      continue;
    }

    const scrapedIndustry = normalizeIndustry(firstFilled(row.normalizedCategory, row.sourceCategory, row.category));
    const score = Number(row.scoreMeta?.finalScore || 0);
    const updateDoc = {
      company_name: companyName,
      website,
      industry: scrapedIndustry,
      Address: clean(row.address),
      employee_range: buildEmployeeRange(row),
      turnover_range: buildTurnoverRange(row),
      similarity_score: score,
      similarity_label: clean(row.scoreMeta?.label),
      source: sourceId,
      source_key: sourceKey,
      location: locationId,
      status: "new",
      is_active: true,
      scraped_lead_id: row._id,
      rating: Number.isFinite(Number(row.rating)) ? Number(row.rating) : undefined,
      reviews_count: Number.isFinite(Number(row.reviewsCount)) ? Number(row.reviewsCount) : undefined,
      raw_score_meta: row.scoreMeta || {},
      scraped_at: row.updatedAt || row.createdAt || new Date(),
    };

    const saved = await AiGeneratedLead.findOneAndUpdate(
      { $or: filterOptions },
      {
        $set: updateDoc,
        $setOnInsert: {
          created_at: row.createdAt || new Date(),
        },
      },
      { new: true, upsert: true }
    ).lean();

    if (existing) {
      updatedCount += 1;
    } else {
      importedCount += 1;
    }

    const contacts = collectContacts(row);
    if (contacts.length && saved?._id) {
      await AiLeadContact.deleteMany({ ai_lead_id: saved._id });
      await AiLeadContact.insertMany(
        contacts.map((contact, index) => ({
          ai_lead_id: saved._id,
          name: contact.name || "Company Contact",
          designation: contact.designation,
          email: contact.email,
          phone: contact.phone,
          linkedin: contact.linkedin,
          is_primary_contact: index === 0,
          created_at: new Date(),
          updated_at: new Date(),
        }))
      );
      contactCount += contacts.length;
    }
  }

  return {
    discoveredCount: scrapedLeads.length,
    importedCount,
    updatedCount,
    skippedCount,
    contactCount,
  };
}

module.exports = {
  syncScrapedLeads,
};
