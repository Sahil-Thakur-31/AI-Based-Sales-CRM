const Client = require("../models/client");
const ClientContact = require("../models/client_contact");
const Industry = require("../models/industries");
const Source = require("../models/sources");

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function numberOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function dateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function boolOrDefault(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

exports.listClients = async (req, res) => {

  try {

    const clients = await Client.find({
      is_deleted: { $ne: true }
    })
    .sort({ createdAt: -1 })
    .lean();

    const industryIds = [
      ...new Set(clients.map((c) => String(c.industry || "")).filter(Boolean))
    ];
    const sourceIds = [
      ...new Set(clients.map((c) => String(c.source || "")).filter(Boolean))
    ];

    const [industries, sources, contactCounts] = await Promise.all([
      Industry.find({ _id: { $in: industryIds } }).select("name").lean(),
      Source.find({ _id: { $in: sourceIds } }).select("name").lean(),
      ClientContact.aggregate([
        {
          $match: {
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
    ]);

    const industryMap = new Map(industries.map((i) => [String(i._id), i.name]));
    const sourceMap = new Map(sources.map((s) => [String(s._id), s.name]));
    const contactsMap = new Map(contactCounts.map((c) => [String(c._id), c.count]));

    const rows = clients.map((client) => ({
      _id: client._id,
      name: client.name || "",
      industry: client.industry || null,
      industryName: industryMap.get(String(client.industry || "")) || "-",
      Address: client.Address || "",
      employeeCount: client.employeeCount ?? null,
      turnoverRange: client.turnoverRange || "",
      website: client.website || "",
      source: client.source || null,
      sourceName: sourceMap.get(String(client.source || "")) || "-",
      deal_count: client.deal_count || 0,
      contactsCount: contactsMap.get(String(client._id)) || 0,
      createdAt: client.createdAt || null,
      updatedAt: client.updatedAt || null
    }));

    res.json(rows);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch clients"
    });

  }

};

exports.getClientById = async (req, res) => {

  try {

    const client = await Client.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true }
    }).lean();

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
        industry: client.industry || "",
        Address: client.Address || "",
        employeeCount: client.employeeCount ?? "",
        turnoverRange: client.turnoverRange || "",
        website: client.website || "",
        source: client.source || "",
        deal_count: client.deal_count ?? 0,
        GST_no: client.GST_no || "",
        URD: client.URD || "",
        Aadhar_doc: client.Aadhar_doc || "",
        PanCard_doc: client.PanCard_doc || "",
        Other_docs: client.Other_docs || "",
        location: client.location || "",
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

exports.updateClient = async (req, res) => {

  try {

    const { client: clientInput = {}, contacts: contactsInput = [] } = req.body || {};

    const existingClient = await Client.findOne({
      _id: req.params.id,
      is_deleted: { $ne: true }
    });

    if (!existingClient) {
      return res.status(404).json({
        message: "Client not found"
      });
    }

    const clientUpdate = {
      updatedAt: new Date()
    };

    if (clientInput.name !== undefined) clientUpdate.name = cleanString(clientInput.name);
    if (clientInput.industry !== undefined) clientUpdate.industry = clientInput.industry || null;
    if (clientInput.Address !== undefined) clientUpdate.Address = cleanString(clientInput.Address);
    if (clientInput.employeeCount !== undefined) clientUpdate.employeeCount = numberOrNull(clientInput.employeeCount);
    if (clientInput.turnoverRange !== undefined) clientUpdate.turnoverRange = cleanString(clientInput.turnoverRange);
    if (clientInput.website !== undefined) clientUpdate.website = cleanString(clientInput.website);
    if (clientInput.source !== undefined) clientUpdate.source = clientInput.source || null;
    if (clientInput.GST_no !== undefined) clientUpdate.GST_no = cleanString(clientInput.GST_no);
    if (clientInput.URD !== undefined) clientUpdate.URD = cleanString(clientInput.URD);
    if (clientInput.Aadhar_doc !== undefined) clientUpdate.Aadhar_doc = cleanString(clientInput.Aadhar_doc);
    if (clientInput.PanCard_doc !== undefined) clientUpdate.PanCard_doc = cleanString(clientInput.PanCard_doc);
    if (clientInput.Other_docs !== undefined) clientUpdate.Other_docs = cleanString(clientInput.Other_docs);
    if (clientInput.location !== undefined) clientUpdate.location = clientInput.location || null;

    await Client.findByIdAndUpdate(
      existingClient._id,
      { $set: clientUpdate },
      { new: true, runValidators: false }
    );

    if (Array.isArray(contactsInput)) {
      for (const contact of contactsInput) {
        if (!contact) continue;

        if (contact._id) {
          const contactUpdate = {
            updatedAt: new Date()
          };

          if (contact.name !== undefined) contactUpdate.name = cleanString(contact.name);
          if (contact.designation !== undefined) contactUpdate.designation = cleanString(contact.designation);
          if (contact.phone !== undefined) contactUpdate.phone = cleanString(contact.phone);
          if (contact.email !== undefined) contactUpdate.email = cleanString(contact.email);
          if (contact.linkedin !== undefined) contactUpdate.linkedin = cleanString(contact.linkedin);
          if (contact.is_active !== undefined) {
            const isActive = boolOrDefault(contact.is_active, true);
            contactUpdate.is_active = isActive;
            contactUpdate.is_deleted = isActive ? null : new Date();
          }

          await ClientContact.findByIdAndUpdate(
            contact._id,
            { $set: contactUpdate },
            { runValidators: false }
          );
        } else if (cleanString(contact.name)) {
          await ClientContact.create({
            client_id: String(existingClient._id),
            name: cleanString(contact.name),
            designation: cleanString(contact.designation),
            phone: cleanString(contact.phone),
            email: cleanString(contact.email),
            linkedin: cleanString(contact.linkedin),
            createdBy: req.user?._id,
            is_active: boolOrDefault(contact.is_active, true),
            is_deleted: boolOrDefault(contact.is_active, true) ? null : new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
    }

    const updatedClient = await Client.findById(existingClient._id).lean();
    const contacts = await ClientContact.find({
      client_id: String(existingClient._id),
      is_active: { $ne: false }
    }).lean();

    res.json({
      client: updatedClient,
      contacts
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to update client"
    });

  }

};
// alias existing list handler to expected name
exports.getClients = exports.listClients;

// create a new client
exports.createClient = async (req, res) => {
  try {
    const data = req.body || {};
    const client = new Client({
      name: cleanString(data.name),
      industry: data.industry || null,
      Address: cleanString(data.Address),
      employeeCount: numberOrNull(data.employeeCount),
      turnoverRange: cleanString(data.turnoverRange),
      website: cleanString(data.website),
      source: data.source || null,
      deal_count: numberOrNull(data.deal_count) || 0,
      GST_no: cleanString(data.GST_no),
      URD: cleanString(data.URD),
      Aadhar_doc: cleanString(data.Aadhar_doc),
      PanCard_doc: cleanString(data.PanCard_doc),
      Other_docs: cleanString(data.Other_docs),
      location: data.location || null,
      is_deleted: false
    });
    await client.save();
    res.json({ message: "Client created", client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create client" });
  }
};

// soft-delete client
exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, { is_deleted: true }, { new: true }).lean();
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json({ message: "Client deleted", client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete client" });
  }
};

// reactivate client
exports.activateClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, { is_deleted: false }, { new: true }).lean();
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json({ message: "Client activated", client });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to activate client" });
  }
};
