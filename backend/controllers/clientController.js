const Client = require("../models/client");
const Industry = require("../models/industries");
const Source = require("../models/sources");
const ClientContact = require("../models/client_contact");
const User = require("../models/users");
const Event = require("../models/events");
const { normalizePhone } = require("../utils/phoneUtils");

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSourceName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isReferenceLikeSource(sourceName) {
  const normalized = normalizeSourceName(sourceName);
  return /(ref|refer|reference|referr|reffe|refee)/.test(normalized);
}

function isEventExpoLikeSource(sourceName) {
  const normalized = normalizeSourceName(sourceName);
  return (
    (normalized.includes("event") && normalized.includes("expo")) ||
    normalized.includes("events n expos")
  );
}

function normalizeContactValues(value) {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => String(item || "").split(/\s*(?:\||,|;|\n)\s*/))
    : String(value || "").split(/\s*(?:\||,|;|\n)\s*/);

  return rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => {
      const normalized = item.toLowerCase();
      return normalized && normalized !== "unreadable" && normalized !== "undefined" && normalized !== "null";
    });
}

async function applySourceDependentValidation(payload, sourceDoc) {
  if (!sourceDoc?._id) {
    payload.referred_by_user = null;
    payload.expo_event_id = null;
    return;
  }

  if (isReferenceLikeSource(sourceDoc.name)) {
    if (!payload.referred_by_user) {
      const err = new Error("Reference source requires selecting a referred user");
      err.statusCode = 400;
      throw err;
    }
    const referredUser = await User.findOne({
      _id: payload.referred_by_user,
      is_deleted: { $ne: true },
    })
      .select("_id")
      .lean();
    if (!referredUser) {
      const err = new Error("Invalid referred user selected");
      err.statusCode = 400;
      throw err;
    }
    payload.expo_event_id = null;
    return;
  }

  if (isEventExpoLikeSource(sourceDoc.name)) {
    if (!payload.expo_event_id) {
      const err = new Error("Event & Expo source requires selecting an event/expo");
      err.statusCode = 400;
      throw err;
    }
    const eventDoc = await Event.findOne({
      _id: payload.expo_event_id,
      is_deleted: false,
    })
      .select("_id")
      .lean();
    if (!eventDoc) {
      const err = new Error("Invalid event/expo selected");
      err.statusCode = 400;
      throw err;
    }
    payload.referred_by_user = null;
    return;
  }

  payload.referred_by_user = null;
  payload.expo_event_id = null;
}

exports.getClients = async (req, res) => {
  try {
    const deletedOnly = String(req.query?.deleted_only || "").toLowerCase() === "true";

    const clients = await Client.find({ is_deleted: deletedOnly })
      .populate("industry", "name")
      .populate("source", "name")
      .sort({ createdAt: -1 })
      .lean();

    const clientIds = clients.map((client) => String(client._id));
    const contactsAgg = clientIds.length
      ? await ClientContact.aggregate([
        {
          $match: {
            client_id: { $in: clientIds },
            is_active: { $ne: false }
          }
        },
        {
          $group: {
            _id: "$client_id",
            count: { $sum: 1 }
          }
        }
      ])
      : [];

    const contactsCountMap = new Map(
      contactsAgg.map((item) => [String(item._id), item.count])
    );
    const primaryContacts = clientIds.length
      ? await ClientContact.find({
        client_id: { $in: clientIds },
        is_active: { $ne: false }
      })
        .sort({ is_primary: -1, createdAt: 1 })
        .lean()
      : [];
    const primaryContactMap = new Map();
    for (const contact of primaryContacts) {
      const key = String(contact?.client_id || "");
      if (!key || primaryContactMap.has(key)) continue;
      primaryContactMap.set(key, {
        name: contact?.name || "",
        email: contact?.email || "",
        phone: contact?.phone || ""
      });
    }

    const data = clients.map((client) => ({
      _id: client._id,
      name: client.name || "",
      industry: client.industry?._id || client.industry || "",
      industryName: client.industry?.name || "-",
      Address: client.Address || "",
      employeeCount: client.employeeCount || 0,
      turnoverRange: client.turnoverRange || "",
      website: client.website || "",
      source: client.source?._id || client.source || "",
      sourceName: client.source?.name || "-",
      referred_by_user: client.referred_by_user || "",
      expo_event_id: client.expo_event_id || "",
      deal_count: client.deal_count || 0,
      GST_no: client.GST_no || "",
      contactsCount: contactsCountMap.get(String(client._id)) || 0,
      primaryContact: primaryContactMap.get(String(client._id)) || null
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
};

exports.getClientById = async (req, res) => {

  try {

    const client = await Client.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true }
    })
      .populate("industry", "name")
      .populate("source", "name")
      .populate("location", "country state State city area district pincode")
      .lean();

    if (!client) {
      return res.status(404).json({
        message: "Client not found"
      });
    }

    const contacts = await ClientContact.find({
      client_id: String(client._id),
      is_active: { $ne: false }
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      client: {
        _id: client._id,
        name: client.name || "",
        industry: client.industry?._id || client.industry || "",
        industryName: client.industry?.name || "",
        Address: client.Address || "",
        employeeCount: client.employeeCount ?? "",
        turnoverRange: client.turnoverRange || "",
        website: client.website || "",
        source: client.source?._id || client.source || "",
        sourceName: client.source?.name || "",
        referred_by_user: client.referred_by_user || "",
        expo_event_id: client.expo_event_id || "",
        deal_count: client.deal_count ?? 0,
        GST_no: client.GST_no || "",
        URD: client.URD || "",
        Aadhar_doc: client.Aadhar_doc || "",
        PanCard_doc: client.PanCard_doc || "",
        Other_docs: client.Other_docs || "",
        location: client.location?._id || client.location || "",
        country: client.location?.country || "",
        state: client.location?.state || client.location?.State || "",
        State: client.location?.State || client.location?.state || "",
        district: client.location?.district || "",
        city: client.location?.city || "",
        area: client.location?.area || "",
        pincode: client.location?.pincode || "",
        createdAt: client.createdAt || null,
        updatedAt: client.updatedAt || null
      },
      contacts: contacts.map((contact) => ({
        _id: contact._id,
        client_id: contact.client_id || "",
        name: contact.name || "",
        designation: contact.designation || "",
        phone: contact.phone || "",
        email: contact.email || "",
        linkedin: contact.linkedin || "",
        is_active: contact.is_active ?? true,
        is_deleted: contact.is_deleted || null,
        is_primary: Boolean(contact.is_primary),
        createdAt: contact.createdAt || null,
        updatedAt: contact.updatedAt || null
      }))
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch client details"
    });

  }

};

exports.createClient = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const industry = req.body.industry || null;

    if (!name) {
      return res.status(400).json({ message: "Client name is required" });
    }

    if (!industry) {
      return res.status(400).json({ message: "Industry is required" });
    }

    const industryExists = await Industry.findOne({
      _id: industry,
      is_deleted: false
    }).lean();

    if (!industryExists) {
      return res.status(400).json({ message: "Invalid industry selected" });
    }

    let sourceExists = null;
    if (req.body.source) {
      sourceExists = await Source.findOne({
        _id: req.body.source,
        is_deleted: false
      })
        .select("_id name")
        .lean();
      if (!sourceExists) {
        return res.status(400).json({ message: "Invalid source selected" });
      }
    }

    const sourceLinkedPayload = {
      referred_by_user: req.body.referred_by_user || null,
      expo_event_id: req.body.expo_event_id || null,
    };
    await applySourceDependentValidation(sourceLinkedPayload, sourceExists);

    const client = await Client.create({
      name,
      industry,
      Address: req.body.Address || "",
      employeeCount: parseNumber(req.body.employeeCount, 0),
      turnoverRange: req.body.turnoverRange || "",
      website: req.body.website || "",
      source: req.body.source || null,
      referred_by_user: sourceLinkedPayload.referred_by_user,
      expo_event_id: sourceLinkedPayload.expo_event_id,
      deal_count: parseNumber(req.body.deal_count, 0),
      createdBy: req.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
      is_deleted: false,
      GST_no: req.body.GST_no || "",
      URD: req.body.URD || "",
      Aadhar_doc: req.body.Aadhar_doc || "",
      PanCard_doc: req.body.PanCard_doc || "",
      Other_docs: req.body.Other_docs || "",
      location: req.body.location || null
    });

    const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    const contactRows = contacts
      .map((contact) => ({
        name: String(contact?.name || "").trim(),
        designation: String(contact?.designation || "").trim(),
        phone: normalizeContactValues(contact?.phone).map((item) => normalizePhone(item)).filter(Boolean).join(", "),
        email: normalizeContactValues(contact?.email).join(", "),
        linkedin: String(contact?.linkedin || "").trim(),
        is_active: contact?.is_active !== false,
        is_primary: contact?.is_primary === true || contact?.is_primary === "true"
      }))
      .filter((contact) => contact.name || contact.phone || contact.email);

    // If no one is marked primary, default first to primary
    if (contactRows.length > 0 && !contactRows.some(c => c.is_primary)) {
      contactRows[0].is_primary = true;
    }

    if (contactRows.length) {
      await ClientContact.insertMany(
        contactRows.map((contact) => ({
          client_id: String(client._id),
          name: contact.name || "Unnamed Contact",
          designation: contact.designation,
          phone: contact.phone,
          email: contact.email,
          linkedin: contact.linkedin,
          createdBy: req.user._id,
          createdAt: new Date(),
          updatedAt: new Date(),
          is_active: contact.is_active,
          is_primary: contact.is_primary
        }))
      );
    }

    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ message: err.message || "Failed to create client" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const updateData = {
      updatedAt: new Date()
    };

    const clientData = req.body.client || req.body;

    if (clientData.name !== undefined) updateData.name = String(clientData.name || "").trim();
    if (clientData.industry !== undefined) updateData.industry = clientData.industry || null;
    if (clientData.Address !== undefined) updateData.Address = clientData.Address || "";
    if (clientData.employeeCount !== undefined) updateData.employeeCount = parseNumber(clientData.employeeCount, 0);
    if (clientData.turnoverRange !== undefined) updateData.turnoverRange = clientData.turnoverRange || "";
    if (clientData.website !== undefined) updateData.website = clientData.website || "";
    if (clientData.source !== undefined) updateData.source = clientData.source || null;
    if (clientData.referred_by_user !== undefined) updateData.referred_by_user = clientData.referred_by_user || null;
    if (clientData.expo_event_id !== undefined) updateData.expo_event_id = clientData.expo_event_id || null;
    if (clientData.deal_count !== undefined) updateData.deal_count = parseNumber(clientData.deal_count, 0);
    if (clientData.GST_no !== undefined) updateData.GST_no = clientData.GST_no || "";
    if (clientData.URD !== undefined) updateData.URD = clientData.URD || "";
    if (clientData.Aadhar_doc !== undefined) updateData.Aadhar_doc = clientData.Aadhar_doc || "";
    if (clientData.PanCard_doc !== undefined) updateData.PanCard_doc = clientData.PanCard_doc || "";
    if (clientData.Other_docs !== undefined) updateData.Other_docs = clientData.Other_docs || "";
    if (clientData.location !== undefined) updateData.location = clientData.location || null;

    if (updateData.industry) {
      const industryExists = await Industry.findOne({
        _id: updateData.industry,
        is_deleted: false
      }).lean();
      if (!industryExists) {
        return res.status(400).json({ message: "Invalid industry selected" });
      }
    }

    let sourceExists = null;
    if (updateData.source) {
      sourceExists = await Source.findOne({
        _id: updateData.source,
        is_deleted: false
      })
        .select("_id name")
        .lean();
      if (!sourceExists) {
        return res.status(400).json({ message: "Invalid source selected" });
      }
    }

    if (updateData.source !== undefined || updateData.referred_by_user !== undefined || updateData.expo_event_id !== undefined) {
      const existingClient = await Client.findOne({
        _id: req.params.id,
        is_deleted: false
      })
        .select("source referred_by_user expo_event_id")
        .lean();
      if (!existingClient) {
        return res.status(404).json({ message: "Client not found" });
      }
      const effectiveSourceId = updateData.source !== undefined ? updateData.source : existingClient.source;
      let effectiveSourceDoc = null;
      if (effectiveSourceId) {
        effectiveSourceDoc = await Source.findOne({
          _id: effectiveSourceId,
          is_deleted: false
        })
          .select("_id name")
          .lean();
        if (!effectiveSourceDoc) {
          return res.status(400).json({ message: "Invalid source selected" });
        }
      }
      const sourceLinkedPayload = {
        referred_by_user:
          updateData.referred_by_user !== undefined
            ? updateData.referred_by_user
            : existingClient.referred_by_user || null,
        expo_event_id:
          updateData.expo_event_id !== undefined
            ? updateData.expo_event_id
            : existingClient.expo_event_id || null,
      };
      await applySourceDependentValidation(sourceLinkedPayload, effectiveSourceDoc);
      updateData.referred_by_user = sourceLinkedPayload.referred_by_user;
      updateData.expo_event_id = sourceLinkedPayload.expo_event_id;
    }

    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    if (Array.isArray(req.body.contacts)) {
      await ClientContact.deleteMany({ client_id: req.params.id });

      const contacts = req.body.contacts;
      const contactRows = contacts
        .map((contact) => ({
          name: String(contact?.name || "").trim(),
          designation: String(contact?.designation || "").trim(),
          phone: normalizeContactValues(contact?.phone).map((item) => normalizePhone(item)).filter(Boolean).join(", "),
          email: normalizeContactValues(contact?.email).join(", "),
          linkedin: String(contact?.linkedin || "").trim(),
          is_active: contact?.is_active !== false,
          is_primary: contact?.is_primary === true || contact?.is_primary === "true"
        }))
        .filter((contact) => contact.name || contact.phone || contact.email);

      // If no one is marked primary, default first to primary
      if (contactRows.length > 0 && !contactRows.some(c => c.is_primary)) {
        contactRows[0].is_primary = true;
      }

      if (contactRows.length > 0) {
        await ClientContact.insertMany(
          contactRows.map((contact) => ({
            client_id: String(client._id),
            name: contact.name || "Unnamed Contact",
            designation: contact.designation,
            phone: contact.phone,
            email: contact.email,
            linkedin: contact.linkedin,
            createdBy: req.user._id,
            createdAt: new Date(),
            updatedAt: new Date(),
            is_active: contact.is_active,
            is_primary: contact.is_primary
          }))
        );
      }
    }

    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ message: err.message || "Update failed" });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    res.json({ message: "Client deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
};

exports.activateClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    res.json({ message: "Client restored successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Restore failed" });
  }
};
