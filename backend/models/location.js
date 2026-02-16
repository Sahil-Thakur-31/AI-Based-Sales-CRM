const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
 

  State: {
    type: String
  },

  city: {
    type: String
  },

  country: {
    type: String
  },

  zone: {
    type: String   // kept as string exactly as given
  }

}, {
  collection: "location"
});

module.exports = mongoose.model("location", locationSchema);
