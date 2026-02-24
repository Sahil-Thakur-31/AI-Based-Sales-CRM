const mongoose = require("mongoose");

const industriesSchema = new mongoose.Schema({

  name: {
    type: String
  },

  description: {
    type: String
  },

  is_deleted: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  }

});

module.exports = mongoose.model("industries", industriesSchema);
