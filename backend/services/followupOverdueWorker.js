const mongoose = require("mongoose");
const Followup = require("../models/followUp");
const Meeting = require("../models/meetings");

const OVERDUE_AFTER_MINUTES = 120;
const BATCH_SIZE = 200;

let isProcessing = false;
let workerTimer = null;

function getOverdueCutoff(now = new Date()) {
  return new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60 * 1000);
}

async function processOverdueFollowups() {
  if (isProcessing) return;
  if (mongoose.connection.readyState !== 1) return;
  isProcessing = true;

  try {
    const cutoff = getOverdueCutoff();
    const overdueDocs = await Followup.find({
      is_deleted: { $ne: true },
      status: "pending",
      dueDateTime: { $lte: cutoff },
    })
      .select("_id")
      .sort({ dueDateTime: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!overdueDocs.length) return;

    const overdueIds = overdueDocs.map((doc) => doc._id);
    const now = new Date();

    await Followup.updateMany(
      {
        _id: { $in: overdueIds },
        status: "pending",
        is_deleted: { $ne: true },
      },
      {
        $set: {
          status: "overdue",
          updatedAt: now,
        },
      }
    );

    await Meeting.updateMany(
      {
        sourceFollowupId: { $in: overdueIds },
        is_deleted: { $ne: true },
        status: { $nin: ["completed", "cancelled"] },
      },
      {
        $set: {
          status: "overdue",
          updatedAt: now,
        },
      }
    );
  } catch (err) {
    console.error("followupOverdueWorker error:", err);
  } finally {
    isProcessing = false;
  }
}

function startFollowupOverdueWorker() {
  if (workerTimer) return;

  processOverdueFollowups().catch((err) => {
    console.error("followupOverdueWorker initial run error:", err);
  });

  workerTimer = setInterval(() => {
    processOverdueFollowups().catch((err) => {
      console.error("followupOverdueWorker loop error:", err);
    });
  }, 60 * 1000);
}

module.exports = {
  startFollowupOverdueWorker,
  processOverdueFollowups,
  getOverdueCutoff,
};
