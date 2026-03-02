const mongoose = require("mongoose");

const meetingsSchema = new mongoose.Schema({

  title: {
    type: String
  },

  sourceFollowupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Followup",
    index: true
  },

  clientName: {
    type: String
  },

  actionType: {
    type: String
  },

  description: {
    type: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users"
  },

  Id: {
    type: mongoose.Schema.Types.ObjectId
  },

  meetingType: {
    type: String,
    enum: ["online", "physical"]
  },

  meetingDate: {
    type: Date
  },

  startTime: {
    type: Date
  },

  durationMinutes: {
    type: Number
  },

  priority: {
    type: String,
    enum: ["low", "medium", "high", "urgent"]
  },

  timezone: {
    type: String
  },

  location: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "location"
  },

  Address: {
    type: String
  },

  status: {
    type: String,
    enum: [
      "scheduled",
      "completed",
      "cancelled",
      "rescheduled",
      "no_show"
    ]
  },

  latitude: {
    type: String
  },

  longitude: {
    type: String
  },

  nextAction: {
    type: String
  },

  followupRequired: {
    type: Boolean
  },

  followupDate: {
    type: Date
  },

  attendees: [
    {
      type: mongoose.Schema.Types.ObjectId
    }
  ],

  aiSuggestedTime: {
    type: Boolean
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  },

  is_deleted: {
    type: Boolean
  },

  minutes_of_meeting: {
    type: String
  },

  agenda_of_meating: {
    type: String
  }

});

module.exports = mongoose.model("meetings", meetingsSchema);
