const Location = require("../models/location");

exports.getLocations = async (req, res) => {
  try {
    const locations = await Location.find({}).sort({ country: 1, State: 1, city: 1, zone: 1 });
    res.json(locations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
