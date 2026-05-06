const AiGeneratedLead = require("../models/ai_generated_leads");
const AiLeadContact = require("../models/ai_lead_contacts");
const Lead = require("../models/leads");
const LeadContact = require("../models/leadContacts");
const LeadScraperRun = require("../models/leadScraperRuns");

function toTitleStatus(status) {
  return status === "imported" ? "Imported" : "New";
}

function getLeadTemperature(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return "cold";
  if (numeric >= 90) return "hot";
  if (numeric >= 75) return "warm";
  return "cold";
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
  return contact?.email || "";
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
    const [aiLeads, importedCount, lastRun] = await Promise.all([
      AiGeneratedLead.find({ is_deleted: { $ne: true } })
        .sort({ scraped_at: -1, created_at: -1 })
        .populate("source", "name")
        .populate("location", "city district State state country")
        .lean(),
      AiGeneratedLead.countDocuments({ status: "imported" }),
      LeadScraperRun.findOne({})
        .sort({ startedAt: -1 })
        .lean(),
    ]);

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
        industry: lead.industry || "-",
        source: lead.source?.name || "Unknown",
        location: formatLocation(lead),
        employees: lead.employee_range || "-",
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
        industry: aiLead.industry || "",
        employee_count: parseEmployeeCount(aiLead.employee_range),
        turnover_range: aiLead.turnover_range || "",
        Address: aiLead.Address || "",
        website: aiLead.website || "",
        source: aiLead.source || null,
        lead_temperature: getLeadTemperature(aiLead.similarity_score),
        deal_value_estimate: 0,
        assigned_to: req.user?._id || null,
        status: "new",
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
