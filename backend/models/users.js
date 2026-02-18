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
    ref: "roles",   // FK → role collection
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

  is_active: {
    type: Boolean,
    default: true
  },

  is_deleted: {
    type: Boolean,
    default: false
  }

}, {
  collection: "users",
  timestamps: {
    createdAt: "createdAt",
    updatedAt: "updatedAt"
  }
});

module.exports = mongoose.model("users", usersSchema);
