const Location = require("../models/location");

exports.getLocations = async (req, res) => {
  try {
    const locations = await Location.find({})
      .sort({ country: 1, state: 1, district: 1, city: 1, area: 1, pincode: 1 })
      .lean();
    res.json(locations);
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
      area: location.area || location.zone || "",
      pincode: location.pincode || "",
      State: location.State || location.state || "",
      zone: location.zone || location.area || "",
      matches: locations.map((row) => ({
        _id: row._id,
        country: row.country || "",
        state: row.state || row.State || "",
        district: row.district || "",
        city: row.city || "",
        area: row.area || row.zone || "",
        pincode: row.pincode || "",
        State: row.State || row.state || "",
        zone: row.zone || row.area || ""
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
