const Deal = require("../models/deals");
const Client = require("../models/client");

exports.getDeals = async (req, res) => {

  try {

    const deals = await Deal.find({
      is_deleted: { $ne: true }
    })
    .sort({ createdAt: -1 })
    .select("client_id clientName stage status dealValue");

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
        ? (clientMap.get(String(deal.client_id)) || deal.clientName || "Unknown Client")
        : (deal.clientName || "Unlinked Deal");

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
