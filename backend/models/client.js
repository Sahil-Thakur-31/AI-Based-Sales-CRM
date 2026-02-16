const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({


  name: {
    type: String,
    required: true
  },

  industry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "industries",   // FK → industries
    required: true
  },

  Address: {
    type: String
  },

  employeeCount: {
    type: Number
  },

  turnoverRange: {
    type: String
  },

  website: {
    type: String
  },

  source: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "sources"   // FK → sources
  },

  deal_count: {
    type: Number,
    default: 0
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",   // FK → users
    required: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  is_deleted: {
    type: Boolean,
    default: false
  },

  GST_no: {
    type: String
  },

  URD: {
    type: String
  },

  Aadhar_doc: {
    type: String
  },

  PanCard_doc: {
    type: String
  },

  Other_docs: {
    type: String
  },

  location: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "location"   // FK → location
  }

}, {
  collection: "client"
});

module.exports = mongoose.model("client", clientSchema);
