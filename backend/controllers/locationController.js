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
    const pincode = String(req.params.pincode || "").trim();
    if (!pincode) {
      return res.status(400).json({ message: "Pincode is required" });
    }

    const location = await Location.findOne({ pincode }).lean();
    if (!location) {
      return res.status(404).json({ message: "Pincode not found" });
    }

    res.json({
      _id: location._id,
      country: location.country || "",
      state: location.state || location.State || "",
      district: location.district || "",
      city: location.city || "",
      area: location.area || location.zone || "",
      pincode: location.pincode || "",
      State: location.State || location.state || "",
      zone: location.zone || location.area || ""
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
