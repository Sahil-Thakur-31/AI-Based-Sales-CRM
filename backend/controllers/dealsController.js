const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Client = require("../models/client");
const User = require("../models/users");
const Team = require("../models/teams");

function normalizeRole(roleName = "") {
  return String(roleName).trim().toLowerCase();
}

function isAdmin(roleName) {
  return normalizeRole(roleName) === "admin";
}

function isManager(roleName) {
  return normalizeRole(roleName) === "manager";
}

function isSales(roleName) {
  const r = normalizeRole(roleName);
  return r === "sales person" || r === "salesperson" || r === "sales";
}

async function getAccessibleUserIds(reqUser) {
  const myId = String(reqUser._id);
  let roleName = reqUser.role;

  if (!isAdmin(roleName) && !isManager(roleName) && !isSales(roleName)) {
    const me = await User.findById(reqUser._id).populate("role", "name").select("_id role");
    roleName = me?.role?.name || roleName;
  }

  if (isSales(roleName)) return [myId];

  if (isManager(roleName)) {
    const teams = await Team.find({ "teamLead.userId": reqUser._id }).select("members.userId");
    const memberIds = teams.flatMap((t) =>
      (t.members || []).map((m) => String(m.userId)).filter(Boolean)
    );
    return [...new Set([myId, ...memberIds])];
  }

  if (isAdmin(roleName)) {
    const users = await User.find({ is_deleted: { $ne: true } }).populate("role", "name").select("_id role");
    const ids = users
      .filter((u) => {
        const rn = normalizeRole(u.role?.name || "");
        return rn === "admin" || rn === "manager" || isSales(rn);
      })
      .map((u) => String(u._id));
    return [...new Set([myId, ...ids])];
  }

  return [myId];
}

exports.getDeals = async (req, res) => {

  try {
    const allowedIds = await getAccessibleUserIds(req.user);
    const assignedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));

    const deals = await Deal.find({
      is_deleted: { $ne: true },
      assignedTo: { $in: assignedObjectIds },
    })
    .sort({ createdAt: -1 })
    .select("client_id stage status dealValue");

    const clientIds = [
      ...new Set(
        deals
        .map((deal) => deal.client_id ? String(deal.client_id) : "")
        .filter(Boolean)
      )
    ];

    const clients = await Client.find({
      _id: { $in: clientIds },
      is_deleted: { $ne: true }
    })
    .select("name");

    const clientMap = new Map(
      clients.map((client) => [String(client._id), client.name])
    );

    const response = deals.map((deal) => {

      const clientName = deal.client_id
        ? (clientMap.get(String(deal.client_id)) || "Unknown Client")
        : "Unlinked Deal";

      return {
        _id: deal._id,
        stage: deal.stage || "-",
        status: deal.status || "open",
        dealValue: deal.dealValue || 0,
        clientId: deal.client_id || null,
        clientName,
        label: `${deal.stage || "Deal"} - ${clientName}`
      };

    });

    res.json(response);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch deals"
    });

  }

};

exports.getClientSuggestions = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
    const allowedIds = await getAccessibleUserIds(req.user);
    const assignedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));

    const dealClientIds = await Deal.find({
      is_deleted: { $ne: true },
      assignedTo: { $in: assignedObjectIds },
      client_id: { $exists: true, $ne: null },
    }).distinct("client_id");

    const filter = {
      is_deleted: { $ne: true },
      _id: { $in: dealClientIds },
    };
    if (q) {
      filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const clients = await Client.find(filter)
      .select("_id name")
      .sort({ name: 1 })
      .limit(limit);

    res.json(
      clients.map((c) => ({
        _id: c._id,
        name: c.name || "",
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch client suggestions" });
  }
};
