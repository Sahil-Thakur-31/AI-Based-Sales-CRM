const Organization = require("../models/organization");
const User = require("../models/users");
const Client = require("../models/client");
const Deal = require("../models/deals");

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CIN_REGEX = /^[A-Z0-9]{21}$/;
const GST_REGEX = /^[0-9A-Z]{15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

async function buildStats() {
  const [employeesCount, clientsCount, dealsCount] = await Promise.all([
    User.countDocuments({ is_deleted: { $ne: true } }),
    Client.countDocuments({ is_deleted: { $ne: true } }),
    Deal.countDocuments({ is_deleted: { $ne: true } })
  ]);

  return { employeesCount, clientsCount, dealsCount };
}

function mapOrganization(row, stats) {
  if (!row) return null;

  return {
    _id: row._id,
    name: row.name || "",
    logoUrl: row.logoUrl || "",
    address: row.address || "",
    website: row.website || "",
    area: row.area || "",
    city: row.city || "",
    pincode: row.pincode || "",
    district: row.district || "",
    state: row.state || "",
    country: row.country || "",
    panNumber: row.panNumber || "",
    cinNumber: row.cinNumber || "",
    gstNumber: row.gstNumber || "",
    phoneNumber: row.phoneNumber || "",
    alternatePhoneNumber: row.alternatePhoneNumber || "",
    email: row.email || "",
    employeesCount: stats.employeesCount,
    clientsCount: stats.clientsCount,
    dealsCount: stats.dealsCount,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function ensureUniqueIdentifiers({ panNumber, cinNumber, gstNumber, excludeId = null }) {
  if (panNumber) {
    const panFilter = { panNumber, is_deleted: false };
    if (excludeId) panFilter._id = { $ne: excludeId };
    const existingPan = await Organization.findOne(panFilter).select("_id").lean();
    if (existingPan) {
      return "PAN number already exists";
    }
  }

  if (cinNumber) {
    const cinFilter = { cinNumber, is_deleted: false };
    if (excludeId) cinFilter._id = { $ne: excludeId };
    const existingCin = await Organization.findOne(cinFilter).select("_id").lean();
    if (existingCin) {
      return "CIN number already exists";
    }
  }

  if (gstNumber) {
    const gstFilter = { gstNumber, is_deleted: false };
    if (excludeId) gstFilter._id = { $ne: excludeId };
    const existingGst = await Organization.findOne(gstFilter).select("_id").lean();
    if (existingGst) {
      return "GST number already exists";
    }
  }

  return "";
}

exports.getOrganizations = async (req, res) => {
  try {
    const stats = await buildStats();

    const rows = await Organization.find({ is_deleted: false })
      .sort({ createdAt: -1 })
      .lean();

    const response = rows.map((row) => mapOrganization(row, stats));

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch organizations" });
  }
};

exports.createOrganization = async (req, res) => {
  try {
    const name = normalizeText(req.body.name);
    const panNumber = normalizeUpper(req.body.panNumber);
    const cinNumber = normalizeUpper(req.body.cinNumber);
    const gstNumber = normalizeUpper(req.body.gstNumber);
    const email = normalizeEmail(req.body.email);

    if (!name) {
      return res.status(400).json({ message: "Organization name is required" });
    }

    if (panNumber && !PAN_REGEX.test(panNumber)) {
      return res.status(400).json({ message: "Invalid PAN number format" });
    }

    if (cinNumber && !CIN_REGEX.test(cinNumber)) {
      return res.status(400).json({ message: "Invalid CIN number format" });
    }

    if (gstNumber && !GST_REGEX.test(gstNumber)) {
      return res.status(400).json({ message: "Invalid GST number format" });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const existing = await Organization.findOne({ is_deleted: false })
      .select("_id")
      .lean();
    if (existing) {
      return res.status(400).json({
        message: "Only one organization profile is allowed"
      });
    }

    const logoUrl = req.file
      ? `/uploads/organization_logo/${req.file.filename}`
      : normalizeText(req.body.logoUrl);

    const duplicateMessage = await ensureUniqueIdentifiers({ panNumber, cinNumber, gstNumber });
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }

    const organization = await Organization.create({
      name,
      logoUrl,
      address: normalizeText(req.body.address),
      website: normalizeText(req.body.website),
      area: normalizeText(req.body.area),
      city: normalizeText(req.body.city),
      pincode: normalizeText(req.body.pincode),
      district: normalizeText(req.body.district),
      state: normalizeText(req.body.state),
      country: normalizeText(req.body.country),
      panNumber,
      cinNumber,
      gstNumber,
      phoneNumber: normalizeText(req.body.phoneNumber),
      alternatePhoneNumber: normalizeText(req.body.alternatePhoneNumber),
      email,
      createdBy: req.user?._id || null,
      is_deleted: false
    });

    res.status(201).json(organization);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create organization" });
  }
};

exports.getOrganizationProfile = async (req, res) => {
  try {
    const [stats, row] = await Promise.all([
      buildStats(),
      Organization.findOne({ is_deleted: false })
        .sort({ createdAt: -1 })
        .lean()
    ]);

    res.json({
      organization: mapOrganization(row, stats),
      stats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch organization profile" });
  }
};

exports.upsertOrganizationProfile = async (req, res) => {
  try {
    const name = normalizeText(req.body.name);
    const panNumber = normalizeUpper(req.body.panNumber);
    const cinNumber = normalizeUpper(req.body.cinNumber);
    const gstNumber = normalizeUpper(req.body.gstNumber);
    const email = normalizeEmail(req.body.email);

    if (!name) {
      return res.status(400).json({ message: "Organization name is required" });
    }

    if (panNumber && !PAN_REGEX.test(panNumber)) {
      return res.status(400).json({ message: "Invalid PAN number format" });
    }

    if (cinNumber && !CIN_REGEX.test(cinNumber)) {
      return res.status(400).json({ message: "Invalid CIN number format" });
    }

    if (gstNumber && !GST_REGEX.test(gstNumber)) {
      return res.status(400).json({ message: "Invalid GST number format" });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const existing = await Organization.findOne({ is_deleted: false })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();

    const duplicateMessage = await ensureUniqueIdentifiers({
      panNumber,
      cinNumber,
      gstNumber,
      excludeId: existing?._id || null
    });
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }

    const incomingLogoUrl = req.file
      ? `/uploads/organization_logo/${req.file.filename}`
      : normalizeText(req.body.logoUrl);
    const removeLogo = String(req.body.removeLogo || "").toLowerCase() === "true";

    const payload = {
      name,
      logoUrl: incomingLogoUrl || "",
      address: normalizeText(req.body.address),
      website: normalizeText(req.body.website),
      area: normalizeText(req.body.area),
      city: normalizeText(req.body.city),
      pincode: normalizeText(req.body.pincode),
      district: normalizeText(req.body.district),
      state: normalizeText(req.body.state),
      country: normalizeText(req.body.country),
      panNumber,
      cinNumber,
      gstNumber,
      phoneNumber: normalizeText(req.body.phoneNumber),
      alternatePhoneNumber: normalizeText(req.body.alternatePhoneNumber),
      email,
      updatedAt: new Date()
    };

    let organization;
    if (existing?._id) {
      const existingOrganization = await Organization.findOne({
        _id: existing._id,
        is_deleted: false
      })
        .select("logoUrl")
        .lean();

      organization = await Organization.findOneAndUpdate(
        { _id: existing._id, is_deleted: false },
        {
          $set: {
            ...payload,
            logoUrl: removeLogo
              ? ""
              : incomingLogoUrl || existingOrganization?.logoUrl || ""
          }
        },
        { returnDocument: "after" }
      );
    } else {
      organization = await Organization.create({
        ...payload,
        createdBy: req.user?._id || null,
        is_deleted: false
      });
    }

    await Organization.updateMany(
      {
        _id: { $ne: organization._id },
        is_deleted: false
      },
      {
        $set: {
          is_deleted: true,
          updatedAt: new Date()
        }
      }
    );

    const stats = await buildStats();
    res.json({
      organization: mapOrganization(organization.toObject ? organization.toObject() : organization, stats),
      stats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save organization profile" });
  }
};

exports.updateOrganization = async (req, res) => {
  try {
    const name = normalizeText(req.body.name);
    const panNumber = normalizeUpper(req.body.panNumber);
    const cinNumber = normalizeUpper(req.body.cinNumber);
    const gstNumber = normalizeUpper(req.body.gstNumber);
    const email = normalizeEmail(req.body.email);

    if (!name) {
      return res.status(400).json({ message: "Organization name is required" });
    }

    if (panNumber && !PAN_REGEX.test(panNumber)) {
      return res.status(400).json({ message: "Invalid PAN number format" });
    }

    if (cinNumber && !CIN_REGEX.test(cinNumber)) {
      return res.status(400).json({ message: "Invalid CIN number format" });
    }

    if (gstNumber && !GST_REGEX.test(gstNumber)) {
      return res.status(400).json({ message: "Invalid GST number format" });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const logoUrl = req.file
      ? `/uploads/organization_logo/${req.file.filename}`
      : normalizeText(req.body.logoUrl);
    const removeLogo = String(req.body.removeLogo || "").toLowerCase() === "true";

    const duplicateMessage = await ensureUniqueIdentifiers({
      panNumber,
      cinNumber,
      gstNumber,
      excludeId: req.params.id
    });
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }

    const updated = await Organization.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      {
        $set: {
          name,
          logoUrl: removeLogo ? "" : logoUrl,
          address: normalizeText(req.body.address),
          website: normalizeText(req.body.website),
          area: normalizeText(req.body.area),
          city: normalizeText(req.body.city),
          pincode: normalizeText(req.body.pincode),
          district: normalizeText(req.body.district),
          state: normalizeText(req.body.state),
          country: normalizeText(req.body.country),
          panNumber,
          cinNumber,
          gstNumber,
          phoneNumber: normalizeText(req.body.phoneNumber),
          alternatePhoneNumber: normalizeText(req.body.alternatePhoneNumber),
          email,
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      return res.status(404).json({ message: "Organization not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update organization" });
  }
};

exports.deleteOrganization = async (req, res) => {
  try {
    const deleted = await Organization.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!deleted) {
      return res.status(404).json({ message: "Organization not found" });
    }

    res.json({ message: "Organization deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete organization" });
  }
};

exports.restoreOrganization = async (req, res) => {
  try {
    const restored = await Organization.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!restored) {
      return res.status(404).json({ message: "Organization not found" });
    }

    res.json({ message: "Organization restored successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to restore organization" });
  }
};
