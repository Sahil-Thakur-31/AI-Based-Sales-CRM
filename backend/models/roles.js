const mongoose = require("mongoose");

const rolesSchema = new mongoose.Schema({

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
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  }

});

module.exports = mongoose.model("roles", rolesSchema);
