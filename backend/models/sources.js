const mongoose = require("mongoose");

const sourcesSchema = new mongoose.Schema({

  name: {
    type: String
  },

  url: {
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
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }

});

module.exports = mongoose.model("sources", sourcesSchema);
