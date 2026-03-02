const Client = require("../models/client");
const Industry = require("../models/industries");
const Source = require("../models/sources");
const ClientContact = require("../models/client_contact")

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
      deal_count: client.deal_count || 0,
      GST_no: client.GST_no || "",
      contactsCount: contactsCountMap.get(String(client._id)) || 0
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

    if (req.body.source) {
      const sourceExists = await Source.findOne({
        _id: req.body.source,
        is_deleted: false
      }).lean();
      if (!sourceExists) {
        return res.status(400).json({ message: "Invalid source selected" });
      }
    }

    const client = await Client.create({
      name,
      industry,
      Address: req.body.Address || "",
      employeeCount: parseNumber(req.body.employeeCount, 0),
      turnoverRange: req.body.turnoverRange || "",
      website: req.body.website || "",
      source: req.body.source || null,
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
        phone: String(contact?.phone || "").trim(),
        email: String(contact?.email || "").trim(),
        linkedin: String(contact?.linkedin || "").trim(),
        is_active: contact?.is_active !== false
      }))
      .filter((contact) => contact.name || contact.phone || contact.email);

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
          is_active: contact.is_active
        }))
      );
    }

    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create client" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const updateData = {
      updatedAt: new Date()
    };

    if (req.body.name !== undefined) updateData.name = String(req.body.name || "").trim();
    if (req.body.industry !== undefined) updateData.industry = req.body.industry || null;
    if (req.body.Address !== undefined) updateData.Address = req.body.Address || "";
    if (req.body.employeeCount !== undefined) updateData.employeeCount = parseNumber(req.body.employeeCount, 0);
    if (req.body.turnoverRange !== undefined) updateData.turnoverRange = req.body.turnoverRange || "";
    if (req.body.website !== undefined) updateData.website = req.body.website || "";
    if (req.body.source !== undefined) updateData.source = req.body.source || null;
    if (req.body.deal_count !== undefined) updateData.deal_count = parseNumber(req.body.deal_count, 0);
    if (req.body.GST_no !== undefined) updateData.GST_no = req.body.GST_no || "";
    if (req.body.URD !== undefined) updateData.URD = req.body.URD || "";
    if (req.body.Aadhar_doc !== undefined) updateData.Aadhar_doc = req.body.Aadhar_doc || "";
    if (req.body.PanCard_doc !== undefined) updateData.PanCard_doc = req.body.PanCard_doc || "";
    if (req.body.Other_docs !== undefined) updateData.Other_docs = req.body.Other_docs || "";
    if (req.body.location !== undefined) updateData.location = req.body.location || null;

    if (updateData.industry) {
      const industryExists = await Industry.findOne({
        _id: updateData.industry,
        is_deleted: false
      }).lean();
      if (!industryExists) {
        return res.status(400).json({ message: "Invalid industry selected" });
      }
    }

    if (updateData.source) {
      const sourceExists = await Source.findOne({
        _id: updateData.source,
        is_deleted: false
      }).lean();
      if (!sourceExists) {
        return res.status(400).json({ message: "Invalid source selected" });
      }
    }

    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
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
