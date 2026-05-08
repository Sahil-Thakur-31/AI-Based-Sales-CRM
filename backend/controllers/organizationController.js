const axios = require("axios");
const Organization = require("../models/organization");
const User = require("../models/users");
const Client = require("../models/client");
const Deal = require("../models/deals");
const { normalizePhone } = require("../utils/phoneUtils");

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CIN_REGEX = /^[A-Z0-9]{21}$/;
const GST_REGEX = /^[0-9A-Z]{15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GEOCODE_ENDPOINT =
  String(process.env.ORG_GEOCODE_ENDPOINT || process.env.SCRAPER_GEOCODE_ENDPOINT || "").trim() ||
  "https://nominatim.openstreetmap.org/search";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildLocationFields(source) {
  return {
    address: normalizeText(source.address),
    area: normalizeText(source.area),
    city: normalizeText(source.city),
    pincode: normalizeText(source.pincode),
    district: normalizeText(source.district),
    state: normalizeText(source.state),
    country: normalizeText(source.country)
  };
}

function sameLocationFields(left, right) {
  return ["address", "area", "city", "pincode", "district", "state", "country"].every(
    (field) => normalizeText(left?.[field]) === normalizeText(right?.[field])
  );
}

async function geocodeLocation(fields) {
  const queries = [
    [fields.address, fields.area, fields.city, fields.district, fields.state, fields.pincode, fields.country],
    [fields.area, fields.city, fields.state, fields.pincode, fields.country],
    [fields.city, fields.state, fields.country],
    [fields.pincode, fields.country]
  ]
    .map((parts) => parts.filter(Boolean).join(", "))
    .filter(Boolean);

  for (const query of queries) {
    try {
      const response = await axios.get(GEOCODE_ENDPOINT, {
        params: {
          q: query,
          format: "jsonv2",
          limit: 1
        },
        headers: {
          "User-Agent": "AIBasedSalesCRM/1.0"
        },
        timeout: 20000
      });
      const row = Array.isArray(response.data) ? response.data[0] : null;
      const latitude = parseCoordinate(row?.lat);
      const longitude = parseCoordinate(row?.lon);
      if (latitude !== null && longitude !== null) {
        return {
          latitude,
          longitude,
          locationResolvedAt: new Date()
        };
      }
    } catch (err) {
      continue;
    }
  }

  return {
    latitude: null,
    longitude: null,
    locationResolvedAt: null
  };
}

async function resolveOrganizationLocationFields(source, existing = null) {
  const locationFields = buildLocationFields(source);
  if (!Object.values(locationFields).some(Boolean)) {
    return {
      ...locationFields,
      latitude: null,
      longitude: null,
      locationResolvedAt: null
    };
  }

  if (existing && sameLocationFields(locationFields, existing)) {
    return {
      ...locationFields,
      latitude: parseCoordinate(existing.latitude),
      longitude: parseCoordinate(existing.longitude),
      locationResolvedAt: existing.locationResolvedAt || null
    };
  }

  const geocoded = await geocodeLocation(locationFields);
  return {
    ...locationFields,
    ...geocoded
  };
}

function resolveUploadedAssetUrl(req, fieldName) {
  const fieldFiles = req.files?.[fieldName];
  if (Array.isArray(fieldFiles) && fieldFiles[0]?.filename) {
    return `/uploads/organization_logo/${fieldFiles[0].filename}`;
  }

  // Backward compatibility if route is still using single("logo")
  if (fieldName === "logo" && req.file?.filename) {
    return `/uploads/organization_logo/${req.file.filename}`;
  }

  return "";
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
    signatureUrl: row.signatureUrl || "",
    stampUrl: row.stampUrl || "",
    address: row.address || "",
    website: row.website || "",
    area: row.area || "",
    city: row.city || "",
    pincode: row.pincode || "",
    district: row.district || "",
    state: row.state || "",
    country: row.country || "",
    latitude: parseCoordinate(row.latitude),
    longitude: parseCoordinate(row.longitude),
    locationResolvedAt: row.locationResolvedAt || null,
    panNumber: row.panNumber || "",
    cinNumber: row.cinNumber || "",
    gstNumber: row.gstNumber || "",
    phoneNumber: row.phoneNumber || "",
    alternatePhoneNumber: row.alternatePhoneNumber || "",
    email: row.email || "",
    paymentAccountName: row.paymentAccountName || "",
    paymentAccountNumber: row.paymentAccountNumber || "",
    paymentAccountType: row.paymentAccountType || "",
    paymentBankName: row.paymentBankName || "",
    paymentIfscCode: row.paymentIfscCode || "",
    paymentUpiId: row.paymentUpiId || "",
    headName: row.headName || "",
    headRole: row.headRole || "",
    headPhone: row.headPhone || "",
    headEmail: row.headEmail || "",
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

exports.getPublicOrganizationBrand = async (_req, res) => {
  try {
    const row = await Organization.findOne({ is_deleted: false })
      .sort({ createdAt: -1 })
      .select("name logoUrl")
      .lean();

    res.json({
      organization: row
        ? {
            name: row.name || "",
            logoUrl: row.logoUrl || ""
          }
        : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch organization brand" });
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

    const logoUrl = resolveUploadedAssetUrl(req, "logo") || normalizeText(req.body.logoUrl);
    const signatureUrl =
      resolveUploadedAssetUrl(req, "signature") || normalizeText(req.body.signatureUrl);
    const stampUrl = resolveUploadedAssetUrl(req, "stamp") || normalizeText(req.body.stampUrl);
    const resolvedLocation = await resolveOrganizationLocationFields(req.body);

    const duplicateMessage = await ensureUniqueIdentifiers({ panNumber, cinNumber, gstNumber });
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }

    const organization = await Organization.create({
      name,
      logoUrl,
      signatureUrl,
      stampUrl,
      ...resolvedLocation,
      website: normalizeText(req.body.website),
      panNumber,
      cinNumber,
      gstNumber,
      phoneNumber: normalizePhone(req.body.phoneNumber) || "",
      alternatePhoneNumber: normalizePhone(req.body.alternatePhoneNumber) || "",
      email,
      paymentAccountName: normalizeText(req.body.paymentAccountName),
      paymentAccountNumber: normalizeText(req.body.paymentAccountNumber),
      paymentAccountType: normalizeText(req.body.paymentAccountType),
      paymentBankName: normalizeText(req.body.paymentBankName),
      paymentIfscCode: normalizeUpper(req.body.paymentIfscCode),
      paymentUpiId: normalizeText(req.body.paymentUpiId),
      headName: normalizeText(req.body.headName),
      headRole: normalizeText(req.body.headRole),
      headPhone: normalizeText(req.body.headPhone),
      headEmail: normalizeEmail(req.body.headEmail),
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

    const incomingLogoUrl =
      resolveUploadedAssetUrl(req, "logo") || normalizeText(req.body.logoUrl);
    const incomingSignatureUrl =
      resolveUploadedAssetUrl(req, "signature") || normalizeText(req.body.signatureUrl);
    const incomingStampUrl =
      resolveUploadedAssetUrl(req, "stamp") || normalizeText(req.body.stampUrl);
    const removeLogo = String(req.body.removeLogo || "").toLowerCase() === "true";
    const removeSignature = String(req.body.removeSignature || "").toLowerCase() === "true";
    const removeStamp = String(req.body.removeStamp || "").toLowerCase() === "true";

    const payload = {
      name,
      logoUrl: incomingLogoUrl || "",
      signatureUrl: incomingSignatureUrl || "",
      stampUrl: incomingStampUrl || "",
      website: normalizeText(req.body.website),
      panNumber,
      cinNumber,
      gstNumber,
      phoneNumber: normalizePhone(req.body.phoneNumber) || "",
      alternatePhoneNumber: normalizePhone(req.body.alternatePhoneNumber) || "",
      email,
      paymentAccountName: normalizeText(req.body.paymentAccountName),
      paymentAccountNumber: normalizeText(req.body.paymentAccountNumber),
      paymentAccountType: normalizeText(req.body.paymentAccountType),
      paymentBankName: normalizeText(req.body.paymentBankName),
      paymentIfscCode: normalizeUpper(req.body.paymentIfscCode),
      paymentUpiId: normalizeText(req.body.paymentUpiId),
      headName: normalizeText(req.body.headName),
      headRole: normalizeText(req.body.headRole),
      headPhone: normalizeText(req.body.headPhone),
      headEmail: normalizeEmail(req.body.headEmail),
      updatedAt: new Date()
    };

    let organization;
    if (existing?._id) {
      const existingOrganization = await Organization.findOne({
        _id: existing._id,
        is_deleted: false
      })
        .select("logoUrl signatureUrl stampUrl address area city pincode district state country latitude longitude locationResolvedAt")
        .lean();
      const resolvedLocation = await resolveOrganizationLocationFields(req.body, existingOrganization);

      organization = await Organization.findOneAndUpdate(
        { _id: existing._id, is_deleted: false },
        {
          $set: {
            ...payload,
            ...resolvedLocation,
            logoUrl: removeLogo
              ? ""
              : incomingLogoUrl || existingOrganization?.logoUrl || "",
            signatureUrl: removeSignature
              ? ""
              : incomingSignatureUrl || existingOrganization?.signatureUrl || "",
            stampUrl: removeStamp
              ? ""
              : incomingStampUrl || existingOrganization?.stampUrl || ""
          }
        },
        { returnDocument: "after" }
      );
    } else {
      const resolvedLocation = await resolveOrganizationLocationFields(req.body);
      organization = await Organization.create({
        ...payload,
        ...resolvedLocation,
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

    const logoUrl = resolveUploadedAssetUrl(req, "logo") || normalizeText(req.body.logoUrl);
    const signatureUrl =
      resolveUploadedAssetUrl(req, "signature") || normalizeText(req.body.signatureUrl);
    const stampUrl = resolveUploadedAssetUrl(req, "stamp") || normalizeText(req.body.stampUrl);
    const removeLogo = String(req.body.removeLogo || "").toLowerCase() === "true";
    const removeSignature = String(req.body.removeSignature || "").toLowerCase() === "true";
    const removeStamp = String(req.body.removeStamp || "").toLowerCase() === "true";

    const duplicateMessage = await ensureUniqueIdentifiers({
      panNumber,
      cinNumber,
      gstNumber,
      excludeId: req.params.id
    });
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }

    const existingOrganization = await Organization.findOne({
      _id: req.params.id,
      is_deleted: false
    })
      .select("logoUrl signatureUrl stampUrl address area city pincode district state country latitude longitude locationResolvedAt")
      .lean();

    if (!existingOrganization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const resolvedLocation = await resolveOrganizationLocationFields(req.body, existingOrganization);

    const updated = await Organization.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      {
        $set: {
          name,
          logoUrl: removeLogo ? "" : logoUrl || existingOrganization.logoUrl || "",
          signatureUrl: removeSignature
            ? ""
            : signatureUrl || existingOrganization.signatureUrl || "",
          stampUrl: removeStamp ? "" : stampUrl || existingOrganization.stampUrl || "",
          ...resolvedLocation,
          website: normalizeText(req.body.website),
          panNumber,
          cinNumber,
          gstNumber,
          phoneNumber: normalizeText(req.body.phoneNumber),
          alternatePhoneNumber: normalizeText(req.body.alternatePhoneNumber),
          email,
          paymentAccountName: normalizeText(req.body.paymentAccountName),
          paymentAccountNumber: normalizeText(req.body.paymentAccountNumber),
          paymentAccountType: normalizeText(req.body.paymentAccountType),
          paymentBankName: normalizeText(req.body.paymentBankName),
          paymentIfscCode: normalizeUpper(req.body.paymentIfscCode),
          paymentUpiId: normalizeText(req.body.paymentUpiId),
          headName: normalizeText(req.body.headName),
          headRole: normalizeText(req.body.headRole),
          headPhone: normalizeText(req.body.headPhone),
          headEmail: normalizeEmail(req.body.headEmail),
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
