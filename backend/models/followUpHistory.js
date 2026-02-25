const mongoose = require("mongoose");

const followupHistorySchema = new mongoose.Schema(
  {
    followupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Followup",
      required: true,
      index: true
    },

    actionType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true
      // examples: created, call_made, email_sent, meeting_done, status_changed
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000
    },

    is_deleted: {
      type: Boolean,
      default: false,
      index: true
    }

  },
  {
    timestamps: true,
    versionKey: false
  }
);


// compound index for chronological retrieval
followupHistorySchema.index({ followupId: 1, createdAt: -1 });

// index for audit trails
followupHistorySchema.index({ performedBy: 1, createdAt: -1 });


module.exports = mongoose.model("FollowupHistory", followupHistorySchema);
