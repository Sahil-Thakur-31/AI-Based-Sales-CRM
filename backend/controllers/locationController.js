const Location = require("../models/location");

exports.getLocations = async (req, res) => {
  try {
    const country = String(req.query.country || "").trim();
    const State = String(req.query.State || req.query.state || "").trim();

    let groupKey = "$country";
    let projectKey = "country";
    const match = {};

    if (country) {
      match.country = country;
      groupKey = { $ifNull: ["$State", "$state"] };
      projectKey = "State";
    }

    if (country && State) {
      match.$expr = {
        $eq: [{ $ifNull: ["$State", "$state"] }, State]
      };
      groupKey = "$city";
      projectKey = "city";
    }

    const rows = await Location.aggregate([
      { $match: match },
      { $group: { _id: groupKey, locationId: { $first: "$_id" } } },
      { $project: { _id: "$locationId", [projectKey]: "$_id" } },
      { $match: { [projectKey]: { $type: "string", $ne: "" } } },
      { $sort: { [projectKey]: 1 } }
    ]).allowDiskUse(true);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getLocationByPincode = async (req, res) => {
  try {
    const rawPincode = String(req.params.pincode || "").trim();
    if (!rawPincode) {
      return res.status(400).json({ message: "Pincode is required" });
    }

    const normalizedDigits = rawPincode.replace(/\D/g, "");
    const exactCandidates = [rawPincode];
    if (normalizedDigits && normalizedDigits !== rawPincode) {
      exactCandidates.push(normalizedDigits);
    }

    let locations = await Location.find({ pincode: { $in: exactCandidates } })
      .sort({ country: 1, state: 1, district: 1, city: 1, area: 1 })
      .lean();

    if (!locations.length && normalizedDigits) {
      locations = await Location.find({
        pincode: { $regex: `^${normalizedDigits}\\s*$`, $options: "i" }
      })
        .sort({ country: 1, state: 1, district: 1, city: 1, area: 1 })
        .lean();
    }

    if (!locations.length) {
      return res.status(404).json({ message: "Pincode not found" });
    }

    const location = locations[0];
    res.json({
      _id: location._id,
      country: location.country || "",
      state: location.state || location.State || "",
      district: location.district || "",
      city: location.city || "",
      area: location.area || "",
      pincode: location.pincode || "",
      State: location.State || location.state || "",
      matches: locations.map((row) => ({
        _id: row._id,
        country: row.country || "",
        state: row.state || row.State || "",
        district: row.district || "",
        city: row.city || "",
        area: row.area || "",
        pincode: row.pincode || "",
        State: row.State || row.state || ""
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
