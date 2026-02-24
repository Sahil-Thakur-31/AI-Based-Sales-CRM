const mongoose = require("mongoose");

const sourcesSchema = new mongoose.Schema({

  name: {
    type: String
  },

  url: {
    type: String
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  }

});

module.exports = mongoose.model("sources", sourcesSchema);
