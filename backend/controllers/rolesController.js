const Role = require("../models/roles");

exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find({ is_deleted: false })
      .populate("createdBy", "name")
      .sort({ name: 1 });

    return res.json(roles);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch roles" });
  }
};

exports.createRole = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Role name is required" });
    }

    const exists = await Role.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
      is_deleted: false
    });
    if (exists) {
      return res.status(409).json({ message: "Role already exists" });
    }

    const role = await Role.create({
      name,
      description,
      createdBy: req.user?._id || null,
      createdAt: new Date(),
      is_deleted: false
    });

    return res.status(201).json(role);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Create failed" });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Role name is required" });
    }

    const duplicate = await Role.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: `^${name}$`, $options: "i" },
      is_deleted: false
    });
    if (duplicate) {
      return res.status(409).json({ message: "Role already exists" });
    }

    const role = await Role.findOneAndUpdate(
      { _id: req.params.id, is_deleted: false },
      { name, description, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!role) {
      return res.status(404).json({ message: "Role not found or deleted" });
    }

    return res.json(role);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Update failed" });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findByIdAndUpdate(
      req.params.id,
      { is_deleted: true, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.json({ message: "Role deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Delete failed" });
  }
};

exports.restoreRole = async (req, res) => {
  try {
    const role = await Role.findByIdAndUpdate(
      req.params.id,
      { is_deleted: false, updatedAt: new Date() },
      { returnDocument: "after" }
    );

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.json({ message: "Role restored successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Restore failed" });
  }
};
