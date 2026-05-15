const AiGeneratedLead = require("../models/ai_generated_leads");
const AiLeadContact = require("../models/ai_lead_contacts");
const Lead = require("../models/leads");
const LeadContact = require("../models/leadContacts");
const LeadScraperRun = require("../models/leadScraperRuns");
const { normalizeEmail, normalizeIndustry } = require("../utils/leadNormalization");

function toTitleStatus(status) {
  return status === "imported" ? "Imported" : "New";
}

function parseEmployeeCount(rangeValue) {
  const value = String(rangeValue || "").trim();
  const nums = value.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length === 1) return Number(nums[0]);
  const min = Number(nums[0]);
  const max = Number(nums[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return Math.round((min + max) / 2);
}

function sanitizeEmployeeDisplay(value) {
  const text = String(value || "").trim();
  if (!text || text === "-") return "";
  const numbers = text.match(/\d+/g) || [];
  if (!numbers.length) return text;
  const maxValue = Math.max(...numbers.map((item) => Number(item)).filter(Number.isFinite), 0);
  if (!Number.isFinite(maxValue) || maxValue <= 0 || maxValue > 10000) return "";
  return text;
}

function formatLocation(lead) {
  const location = lead.location;
  if (location && typeof location === "object") {
    const city = location.city || location.district || "";
    const state = location.State || location.state || "";
    const country = location.country || "";
    const parts = [city, state, country].filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  return lead.Address || "-";
}

function mapPrimaryContact(contact) {
  if (!contact) return "";
  const name = contact.name || "";
  const designation = contact.designation || "";
  if (!name && !designation) return "";
  if (!designation) return name;
  return `${name} (${designation})`;
}

function mapContactPhone(contact) {
  return contact?.phone || "";
}

function mapContactEmail(contact) {
  return normalizeEmail(contact?.email);
}

function buildExistingLeadQuery(aiLead) {
  const companyName = String(aiLead.company_name || "").trim();
  const website = String(aiLead.website || "").trim();
  const address = String(aiLead.Address || "").trim();

  const identityOptions = [];
  if (companyName && website) {
    identityOptions.push({ company_name: companyName, website });
  }
  if (companyName && address) {
    identityOptions.push({ company_name: companyName, Address: address });
  }
  if (!identityOptions.length && companyName) {
    identityOptions.push({ company_name: companyName });
  }

  return {
    is_deleted: { $ne: true },
    ...(identityOptions.length ? { $or: identityOptions } : { company_name: companyName }),
  };
}

exports.getAiLeads = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const todayFetchFilter = {
      $or: [
        { scraped_at: { $gte: startOfToday, $lt: startOfTomorrow } },
        {
          $and: [
            { $or: [{ scraped_at: { $exists: false } }, { scraped_at: null }] },
            { created_at: { $gte: startOfToday, $lt: startOfTomorrow } },
          ],
        },
      ],
    };

    const [aiLeads, importedCount, todayFetchedCount, lastRun] = await Promise.all([
      AiGeneratedLead.find({ is_deleted: { $ne: true } })
        .sort({ scraped_at: -1, created_at: -1 })
        .populate("source", "name")
        .populate("location", "city district State state country")
        .lean(),
      AiGeneratedLead.countDocuments({ status: "imported" }),
      AiGeneratedLead.countDocuments(todayFetchFilter),
      LeadScraperRun.findOne({})
        .sort({ startedAt: -1 })
        .lean(),
    ]);

    const leadRepairOps = aiLeads
      .map((lead) => {
        const normalized = normalizeIndustry(lead.industry);
        const employeeRange = sanitizeEmployeeDisplay(lead.employee_range);
        const updates = {};
        if (normalized && normalized !== lead.industry) {
          updates.industry = normalized;
          lead.industry = normalized;
        }
        if (employeeRange !== String(lead.employee_range || "").trim()) {
          updates.employee_range = employeeRange;
          lead.employee_range = employeeRange;
        }
        if (!Object.keys(updates).length) return null;
        return {
          updateOne: {
            filter: { _id: lead._id },
            update: { $set: updates },
          },
        };
      })
      .filter(Boolean);

    if (leadRepairOps.length) {
      await AiGeneratedLead.bulkWrite(leadRepairOps);
    }

    const aiLeadIds = aiLeads.map((item) => item._id);
    const contacts = aiLeadIds.length
      ? await AiLeadContact.find({ ai_lead_id: { $in: aiLeadIds } })
        .sort({ is_primary_contact: -1, created_at: 1 })
        .lean()
      : [];

    const contactMap = new Map();
    for (const contact of contacts) {
      const leadId = String(contact.ai_lead_id || "");
      if (!leadId || contactMap.has(leadId)) continue;
      contactMap.set(leadId, contact);
    }

    const items = aiLeads.map((lead) => {
      const primaryContact = contactMap.get(String(lead._id));
      return {
        _id: lead._id,
        company: lead.company_name || "-",
        website: lead.website || "",
        industry: normalizeIndustry(lead.industry) || "-",
        source: lead.source?.name || "Unknown",
        location: formatLocation(lead),
        employees: sanitizeEmployeeDisplay(lead.employee_range) || "-",
        turnover: lead.turnover_range || "-",
        decisionMaker: mapPrimaryContact(primaryContact),
        phone: mapContactPhone(primaryContact),
        email: mapContactEmail(primaryContact),
        rating: Number.isFinite(Number(lead.rating)) ? Number(lead.rating) : null,
        reviewsCount: Number.isFinite(Number(lead.reviews_count)) ? Number(lead.reviews_count) : null,
        generatedAt: lead.scraped_at || lead.created_at || null,
        status: toTitleStatus(lead.status),
      };
    });

    const activeItems = items.filter((lead) => String(lead.status || "").toLowerCase() !== "imported");
    const industries = [...new Set(activeItems.map((lead) => lead.industry).filter((value) => value && value !== "-"))].sort();

    return res.json({
      items,
      summary: {
        total: activeItems.length,
        imported: importedCount,
        industries: industries.length,
        todayFetchedCount,
        lastRunAt: lastRun?.finishedAt || lastRun?.startedAt || null,
        lastRunStatus: lastRun?.status || "",
        lastImportedCount: Number(lastRun?.syncResult?.importedCount || 0),
        lastUpdatedCount: Number(lastRun?.syncResult?.updatedCount || 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch AI leads" });
  }
};

exports.importAiLead = async (req, res) => {
  try {
    const aiLead = await AiGeneratedLead.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true },
    }).lean();

    if (!aiLead) {
      return res.status(404).json({ message: "AI lead not found" });
    }

    const existingLead = await Lead.findOne(buildExistingLeadQuery(aiLead)).select("_id").lean();

    let targetLeadId = existingLead?._id || null;

    if (!targetLeadId) {
      const newLead = await Lead.create({
        company_name: aiLead.company_name || "",
        industry: normalizeIndustry(aiLead.industry),
        employee_count: parseEmployeeCount(aiLead.employee_range),
        turnover_range: aiLead.turnover_range || "",
        Address: aiLead.Address || "",
        website: aiLead.website || "",
        source: aiLead.source || null,
        deal_value_estimate: 0,
        assigned_to: req.user?._id || null,
        stage: "P3",
        is_active: true,
        location: aiLead.location || null,
      });

      targetLeadId = newLead._id;

      const aiContacts = await AiLeadContact.find({ ai_lead_id: aiLead._id })
        .sort({ is_primary_contact: -1, created_at: 1 })
        .lean();

      if (aiContacts.length) {
        await LeadContact.insertMany(
          aiContacts.map((contact, index) => ({
            lead_id: targetLeadId,
            name: contact.name || "",
            designation: contact.designation || "",
            phone: contact.phone || "",
            email: contact.email || "",
            linkedin: contact.linkedin || "",
            is_primary: index === 0 ? true : Boolean(contact.is_primary_contact),
          }))
        );
      }
    } else {
      await Lead.updateOne(
        { _id: targetLeadId },
        {
          $set: {
            stage: "P3",
            updated_at: new Date(),
          },
        }
      );
    }

    await AiGeneratedLead.updateOne(
      { _id: aiLead._id },
      {
        $set: {
          status: "imported",
          imported_by: req.user?._id || null,
          imported_at: new Date(),
          is_active: false,
          is_deleted: true,
        },
      }
    );

    return res.json({
      message: "AI lead imported successfully",
      leadId: targetLeadId,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to import AI lead" });
  }
};
