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

  failedLoginAttempts: {
    type: Number,
    default: 0
  },

  lockUntil: {
    type: Date,
    default: null
  },

  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "roles",
    required: true
  },

  phone: {
    type: String,
    trim: true,
    match: [/^$|^\d{10,15}$/, "Please enter a valid phone number (10-15 digits)"]
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
  },

  googleCalendar: {
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    connectedAt: { type: Date, default: null }
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
