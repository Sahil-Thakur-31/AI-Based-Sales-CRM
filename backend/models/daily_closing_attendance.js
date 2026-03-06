const mongoose = require("mongoose");
const Counter = require("./counter");

const COUNTER_TYPE = "DAILY_CLOSING_ATTENDANCE";

const dailyClosingAttendanceSchema = new mongoose.Schema(
  {
    daily_closing_attendance_id: {
      type: Number,
      required: true,
      unique: true,
      index: true,
      min: 1,
    },

    attendance_of_date: {
      type: Date,
      default: null,
      index: true,
    },

    daily_closing_date: {
      type: Date,
      default: null,
      index: true,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
  },
  {
    collection: "daily_closing_attendance",
    versionKey: false,
  }
);

dailyClosingAttendanceSchema.pre("validate", async function nextId() {
  if (this.daily_closing_attendance_id) return;

  const DailyClosingAttendanceModel =
    mongoose.models.daily_closing_attendance ||
    mongoose.model("daily_closing_attendance");

  const latest = await DailyClosingAttendanceModel.findOne({})
    .sort({ daily_closing_attendance_id: -1 })
    .select("daily_closing_attendance_id")
    .lean();

  const maxExistingId = Number(latest?.daily_closing_attendance_id || 0);
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

  this.daily_closing_attendance_id = Number(counter?.value || 1);
});

module.exports = mongoose.model("daily_closing_attendance", dailyClosingAttendanceSchema);
