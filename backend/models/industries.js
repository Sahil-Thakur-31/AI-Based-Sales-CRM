const mongoose = require("mongoose");

const industriesSchema = new mongoose.Schema({

  name: {
    type: String
  },

  description: {
    type: String
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  }

});

module.exports = mongoose.model("industries", industriesSchema);
