const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
  {
    fileUrl: {
      type: String,
      required: true,
      trim: true
    },

    ocrConfidence: {
      type: Number,
      min: 0,
      max: 100
    },

    extractedData: {
      vendor: {
        type: String,
        trim: true
      },

      date: {
        type: Date
      },

      amount: {
        type: Number,
        min: 0
      },

      gst: {
        type: Number,
        min: 0
      }
    }
  },
  { _id: false }
);


const approvalSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    approvedAt: {
      type: Date,
      default: null
    },

    remarks: {
      type: String,
      trim: true,
      maxlength: 500
    }
  },
  { _id: false }
);


const expenseSchema = new mongoose.Schema(
  {
    expenseNo: {
      type: Number,
      
      required: true,
      unique: true,
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true
    },

    // polymorphic reference (Lead / Deal / Event)
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    referenceType: {
      type: String,
      required: true,
      enum: ["Lead", "Deal", "Event"],
      index: true
    },

    category: {
      type: String,
      enum: [
        "travel",
        "client_meeting",
        "other",
        "marketing",
        "event"
      ],
      required: true,
      index: true
    },

    otherCategory: {
      type: String,
      trim: true,
      maxlength: 100
    },

    amount: {
      type: Number,
      required: true,
      min: 0
    },

    gstAmount: {
      type: Number,
      min: 0,
      default: 0
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function(value) {
          return value >= this.amount;
        },
        message: "Total amount must be >= base amount"
      },
      index: true
    },

    expenseDate: {
      type: Date,
      required: true,
      index: true
    },

    receipt: {
      type: receiptSchema,
      required: true
    },

    approval: {
      type: approvalSchema,
      default: () => ({})
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000
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


// compound indexes for reporting and finance dashboards
expenseSchema.index({ userId: 1, expenseDate: -1 });

expenseSchema.index({ category: 1, expenseDate: -1 });

expenseSchema.index({ "approval.status": 1, expenseDate: -1 });

expenseSchema.index({ referenceId: 1, referenceType: 1 });


module.exports = mongoose.model("Expense", expenseSchema);
