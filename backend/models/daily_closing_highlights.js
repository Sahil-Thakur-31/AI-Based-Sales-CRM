const mongoose = require("mongoose");
const Counter = require("./counter");

const COUNTER_TYPE = "DAILY_CLOSING_HIGHLIGHTS";

const dailyClosingHighlightsSchema = new mongoose.Schema(
  {
    daily_closing_highlights_id: {
      type: Number,
      required: true,
      unique: true,
      index: true,
      min: 1,
    },

    daily_closing_date: {
      type: Date,
      required: true,
      index: true,
    },

    key_highlights: {
      type: String,
      required: true,
      trim: true,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
      index: true,
    },
  },
  {
    collection: "daily_closing_highlights",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

dailyClosingHighlightsSchema.pre("validate", async function nextId() {
  if (this.daily_closing_highlights_id) return;

  const DailyClosingHighlightsModel =
    mongoose.models.daily_closing_highlights ||
    mongoose.model("daily_closing_highlights");

  const latest = await DailyClosingHighlightsModel.findOne({})
    .sort({ daily_closing_highlights_id: -1 })
    .select("daily_closing_highlights_id")
    .lean();

  const maxExistingId = Number(latest?.daily_closing_highlights_id || 0);
  const existingCounter = await Counter.findOne({ counterType: COUNTER_TYPE });

  if (!existingCounter) {
    await Counter.create({
      counterType: COUNTER_TYPE,
      value: maxExistingId,
    });
  } else if (Number(existingCounter.value || 0) < maxExistingId) {
    existingCounter.value = maxExistingId;
    await existingCounter.save();
  }

  const counter = await Counter.findOneAndUpdate(
    { counterType: COUNTER_TYPE },
    { $inc: { value: 1 } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );

  this.daily_closing_highlights_id = Number(counter?.value || 1);
});

module.exports = mongoose.model("daily_closing_highlights", dailyClosingHighlightsSchema);
