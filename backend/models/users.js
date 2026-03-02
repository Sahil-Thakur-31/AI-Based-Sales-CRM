const mongoose = require("mongoose");

const usersSchema = new mongoose.Schema({

  name: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  passwordHash: {
    type: String,
    required: true
  },

  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "roles",
    required: true
  },

  phone: {
    type: String,
    trim: true
  },

  photoUrl: {
    type: String,
    trim: true
  },

  joiningDate: {
    type: Date
  },

  /* NEW FIELDS */

  address: {
    type: String,
    trim: true,
    maxlength: 500
  },

  dateOfBirth: {
    type: Date
  },

  gender: {
    type: String,
    enum: ["Male", "Female", "Others"],
    trim: true
  },

  /* SYSTEM FLAGS */

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

// register model as singular 'User' so that ref: "User" works across schemas
module.exports = mongoose.model("User", usersSchema);