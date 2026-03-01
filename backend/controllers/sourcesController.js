const Source = require("../models/sources");

exports.getSources = async (req, res) => {
  try {
    const data = await Source.find({ is_deleted: false })
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

    const duplicate = await Source.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
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

    const duplicate = await Source.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: `^${name}$`, $options: "i" },
      is_deleted: false
    });
    if (duplicate) {
      return res.status(409).json({ message: "Source already exists" });
    }

    const source = await Source.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { name, url, updatedAt: new Date() },
      { new: true }
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
    const source = await Source.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { new: true }
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
    const source = await Source.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { new: true }
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
