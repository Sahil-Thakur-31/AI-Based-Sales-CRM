const mongoose = require("mongoose");

const eventBudgetSchema = new mongoose.Schema(
  {
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      unique: true, // one budget per location
      index: true
    },

    budget: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isFinite,
        message: "Budget must be a valid number"
      }
    },

    usedBudget: {
      type: Number,
      default: 0,
      min: 0
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


// ensure remaining budget consistency
eventBudgetSchema.pre("save", function (next) {
  this.remainingBudget = this.budget - this.usedBudget;
  next();
});


// optimized for dashboards and allocation queries
eventBudgetSchema.index({ location: 1, isActive: 1 });


module.exports = mongoose.model("EventBudget", eventBudgetSchema);
