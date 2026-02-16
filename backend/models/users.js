const mongoose = require("mongoose");

const usersSchema = new mongoose.Schema({


  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  passwordHash: {
    type: String,
    required: true
  },

  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "role",   // FK → role collection
    required: true
  },

  phone: {
    type: String
  },

  photoUrl: {
    type: String
  },

  joiningDate: {
    type: Date
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  is_active: {
    type: Boolean,
    default: true
  },

  is_deleted: {
    type: Boolean,
    default: false
  }

}, {
  collection: "users"
});

module.exports = mongoose.model("users", usersSchema);
