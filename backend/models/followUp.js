const mongoose = require("mongoose");

const followupSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      index: true
    },

    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      index: true
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContact",
      index: true
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    kind: {
      type: String,
      enum: ["followup", "meeting"],
      default: "followup",
      index: true
    },

    actionType: {
      type: String,
      trim: true,
      maxlength: 100,
      index: true
      // examples: call, email, meeting, demo, reminder
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300
    },

    clientName: {
      type: String,
      trim: true,
      maxlength: 300,
      index: true
    },

    stage: {
      type: String,
      enum: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
      default: "P1",
      index: true
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000
    },

    durationMinutes: {
      type: Number,
      min: 1
    },

    agenda: {
      type: String,
      trim: true,
      maxlength: 2000
    },

    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      index: true
    },

    currentLocation: {
      type: String,
      trim: true,
      maxlength: 1000
    },

    currentExactLocation: {
      type: String,
      trim: true,
      maxlength: 300
    },

    meetingLocation: {
      type: String,
      trim: true,
      maxlength: 1000
    },

    meetingExactLocation: {
      type: String,
      trim: true,
      maxlength: 300
    },

    address: {
      type: String,
      trim: true,
      maxlength: 1000
    },

    exactLocation: {
      type: String,
      trim: true,
      maxlength: 300
    },

    followupHistory: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FollowupHistory"
      }
    ],

    dueDateTime: {
      type: Date,
      required: true,
      index: true
    },

    reminderEnabled: {
      type: Boolean,
      default: true,
      index: true
    },

    completedAt: {
      type: Date,
      default: null,
      index: true
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true
    },

    status: {
      type: String,
      enum: [
        "pending",
        "completed",
        "overdue",
        "cancelled"
      ],
      default: "pending",
      index: true
    },

    aiScore: {
      type: Number,
      min: 0,
      max: 100,
      index: true
    },

    aiSuggested: {
      type: String,
      trim: true,
      maxlength: 500
    },

    aiReason: {
      type: String,
      trim: true,
      maxlength: 1000
    },

    lastContactDate: {
      type: Date,
      index: true
    },

    nextActionDate: {
      type: Date,
      index: true
    },

    is_deleted: {
      type: Boolean,
      default: false,
      index: true
    },

    whatsappReminder24hSent: {
      type: Boolean,
      default: false,
      index: true
    },

    whatsappReminder1hSent: {
      type: Boolean,
      default: false,
      index: true
    },

    googleEventId: {
      type: String,
      default: null,
      index: true
    }

  },
  {
    timestamps: true,
    versionKey: false
  }
);


// compound indexes for CRM dashboards and AI prioritization
followupSchema.index({ assignedTo: 1, status: 1, dueDateTime: 1 });

followupSchema.index({ leadId: 1, status: 1 });

followupSchema.index({ aiScore: -1, status: 1 });

followupSchema.index({ dueDateTime: 1, status: 1 });


module.exports = mongoose.model("Followup", followupSchema);
