const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");

const Followup = require("../models/followUp");
const Meeting = require("../models/meetings");

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PYTHON_SCRIPT = path.join(ROOT_DIR, "backend", "Followup_Priority_AI", "predict_followup_priority.py");
const MODEL_PATH = path.join(
  ROOT_DIR,
  "backend",
  "Followup_Priority_AI",
  "model_artifacts",
  "current",
  "followup_priority_random_forest.joblib"
);

function toObjectId(value) {
  const raw = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

function diffInDays(fromDate, toDate = new Date()) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function daysUntil(date, fromDate = new Date()) {
  const target = new Date(date);
  const current = new Date(fromDate);
  if (Number.isNaN(target.getTime()) || Number.isNaN(current.getTime())) return 0;
  return Math.floor((target.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizePriority(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "urgent" || raw === "high") return "High";
  if (raw === "medium") return "Medium";
  return "Low";
}

function normalizeFollowupStatus(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["completed", "cancelled", "overdue", "pending"].includes(raw)) return raw;
  return "pending";
}

function normalizeMeetingStatus(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "completed") return "completed";
  if (raw === "cancelled") return "cancelled";
  if (raw === "no_show") return "overdue";
  if (raw === "rescheduled") return "rescheduled";
  return "pending";
}

function shouldPredictFollowup(doc) {
  return String(doc?.status || "").trim().toLowerCase() === "pending";
}

function shouldPredictMeeting(doc) {
  return String(doc?.status || "").trim().toLowerCase() === "scheduled";
}

function getEntityType(doc = {}) {
  if (doc.dealId || doc.clientId) return "deal";
  if (doc.leadId) return "lead";
  return "client";
}

function buildEntityFilter(doc = {}) {
  const dealId = toObjectId(doc.dealId);
  if (dealId) return { dealId };

  const leadId = toObjectId(doc.leadId);
  if (leadId) return { leadId };

  const clientId = toObjectId(doc.clientId);
  if (clientId) return { clientId };

  return null;
}

async function runPrediction(featureRow) {
  const baseArgs = [
    PYTHON_SCRIPT,
    "--model-path",
    MODEL_PATH,
    "--record_type",
    String(featureRow.record_type),
    "--entity_type",
    String(featureRow.entity_type),
    "--stage",
    String(featureRow.stage),
    "--priority",
    String(featureRow.priority),
    "--status",
    String(featureRow.status),
    "--days_since_last_contact",
    String(featureRow.days_since_last_contact),
    "--days_until_event",
    String(featureRow.days_until_event),
    "--overdue_count",
    String(featureRow.overdue_count),
    "--related_count",
    String(featureRow.related_count),
  ];

  const commandsToTry = [
    { command: "python", args: baseArgs },
    { command: "py", args: ["-3", ...baseArgs] },
  ];

  let lastError = null;
  for (const attempt of commandsToTry) {
    try {
      const { stdout } = await execFileAsync(attempt.command, attempt.args, {
        cwd: ROOT_DIR,
        windowsHide: true,
        timeout: 20000,
      });
      const parsed = JSON.parse(stdout || "{}");
      const predicted = String(parsed?.predicted_priority || "").trim();
      return ["Low", "Medium", "High"].includes(predicted) ? predicted : null;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

async function runBatchPrediction(featureRows) {
  if (!Array.isArray(featureRows) || featureRows.length === 0) {
    return [];
  }

  const tempJsonPath = path.join(
    os.tmpdir(),
    `followup-priority-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  await fs.writeFile(tempJsonPath, JSON.stringify(featureRows), "utf8");

  const baseArgs = [
    PYTHON_SCRIPT,
    "--model-path",
    MODEL_PATH,
    "--batch-json",
    tempJsonPath,
  ];

  const commandsToTry = [
    { command: "python", args: baseArgs },
    { command: "py", args: ["-3", ...baseArgs] },
  ];

  let lastError = null;
  try {
    for (const attempt of commandsToTry) {
      try {
        const { stdout } = await execFileAsync(attempt.command, attempt.args, {
          cwd: ROOT_DIR,
          windowsHide: true,
          timeout: 20000,
        });
        const parsed = JSON.parse(stdout || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.map((row) => {
          const predicted = String(row?.predicted_priority || "").trim();
          return ["Low", "Medium", "High"].includes(predicted) ? predicted : null;
        });
      } catch (err) {
        lastError = err;
      }
    }
  } finally {
    await fs.unlink(tempJsonPath).catch(() => {});
  }

  throw lastError;
}

async function buildFollowupFeatures(doc) {
  const now = new Date();
  const entityFilter = buildEntityFilter(doc);
  const baseFilter = entityFilter
    ? {
        ...entityFilter,
        is_deleted: { $ne: true },
        kind: "followup",
      }
    : null;

  const selfId = toObjectId(doc?._id);

  const [relatedCount, overdueCount] = await Promise.all([
    baseFilter
      ? Followup.countDocuments({
          ...baseFilter,
          ...(selfId ? { _id: { $ne: selfId } } : {}),
        })
      : 0,
    baseFilter
      ? Followup.countDocuments({
          ...baseFilter,
          $or: [
            { status: "overdue" },
            {
              status: "pending",
              dueDateTime: { $lt: now },
            },
          ],
        })
      : 0,
  ]);

  return {
    record_type: "followup",
    entity_type: getEntityType(doc),
    stage: String(doc?.stage || "P1"),
    priority: normalizePriority(doc?.priority),
    status: normalizeFollowupStatus(doc?.status),
    days_since_last_contact: diffInDays(doc?.lastContactDate || doc?.updatedAt || doc?.createdAt, now),
    days_until_event: daysUntil(doc?.dueDateTime, now),
    overdue_count: overdueCount,
    related_count: relatedCount,
  };
}

async function buildMeetingFeatures(doc) {
  const now = new Date();
  const entityFilter = buildEntityFilter(doc);
  const baseFilter = entityFilter
    ? {
        ...entityFilter,
        is_deleted: { $ne: true },
      }
    : null;

  const selfId = toObjectId(doc?._id);
  const meetingDate = doc?.startTime || doc?.meetingDate || doc?.dueDateTime || null;

  const [relatedCount, overdueCount] = await Promise.all([
    baseFilter
      ? Meeting.countDocuments({
          ...baseFilter,
          ...(selfId ? { _id: { $ne: selfId } } : {}),
        })
      : 0,
    baseFilter
      ? Meeting.countDocuments({
          ...baseFilter,
          $or: [
            { status: "no_show" },
            {
              status: { $in: ["scheduled", "rescheduled"] },
              meetingDate: { $lt: now },
            },
          ],
        })
      : 0,
  ]);

  return {
    record_type: "meeting",
    entity_type: getEntityType(doc),
    stage: String(doc?.stage || "P1"),
    priority: normalizePriority(doc?.priority),
    status: normalizeMeetingStatus(doc?.status),
    days_since_last_contact: diffInDays(doc?.updatedAt || doc?.createdAt, now),
    days_until_event: daysUntil(meetingDate, now),
    overdue_count: overdueCount,
    related_count: relatedCount,
  };
}

async function predictAndPersistFollowupPriority(followupDoc) {
  if (!followupDoc || String(followupDoc.kind || "").toLowerCase() !== "followup") return null;
  if (!followupDoc._id) return null;

  if (!shouldPredictFollowup(followupDoc)) {
    await Followup.updateOne({ _id: followupDoc._id }, { $set: { aiPriority: null } });
    return null;
  }

  const features = await buildFollowupFeatures(followupDoc);
  const aiPriority = await runPrediction(features);
  if (!aiPriority) return aiPriority;

  await Followup.updateOne({ _id: followupDoc._id }, { $set: { aiPriority } });
  return aiPriority;
}

async function predictAndPersistMeetingPriority(meetingDoc) {
  if (!meetingDoc || !meetingDoc._id) return null;

  if (!shouldPredictMeeting(meetingDoc)) {
    await Meeting.updateOne({ _id: meetingDoc._id }, { $set: { aiPriority: null } });
    if (meetingDoc.sourceFollowupId) {
      await Followup.updateOne({ _id: meetingDoc.sourceFollowupId }, { $set: { aiPriority: null } });
    }
    return null;
  }

  const features = await buildMeetingFeatures(meetingDoc);
  const aiPriority = await runPrediction(features);
  if (!aiPriority) return aiPriority;

  await Meeting.updateOne({ _id: meetingDoc._id }, { $set: { aiPriority } });
  if (meetingDoc.sourceFollowupId) {
    await Followup.updateOne({ _id: meetingDoc.sourceFollowupId }, { $set: { aiPriority } });
  }
  return aiPriority;
}

async function refreshPrioritiesForFollowupAndMeeting(followupDoc, meetingDoc = null) {
  const results = { followupAiPriority: null, meetingAiPriority: null };

  if (followupDoc && String(followupDoc.kind || "").toLowerCase() === "followup") {
    try {
      results.followupAiPriority = await predictAndPersistFollowupPriority(followupDoc);
    } catch (err) {
      console.error("followupPriorityAiService followup prediction error:", err?.message || err);
    }
  }

  if (meetingDoc) {
    try {
      results.meetingAiPriority = await predictAndPersistMeetingPriority(meetingDoc);
    } catch (err) {
      console.error("followupPriorityAiService meeting prediction error:", err?.message || err);
    }
  }

  return results;
}

async function predictAndPersistBatchPriorities(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const preparedItems = await Promise.all(items.map(async (item) => {
    const type = String(item?.type || "").trim().toLowerCase();
    const doc = item?.doc || null;

    if (type === "followup") {
      if (!doc?._id || String(doc.kind || "").toLowerCase() !== "followup") {
        return { type, doc, predictionEligible: false, aiPriority: null };
      }
      if (!shouldPredictFollowup(doc)) {
        return { type, doc, predictionEligible: false, aiPriority: null };
      }
      return {
        type,
        doc,
        predictionEligible: true,
        featureRow: await buildFollowupFeatures(doc),
      };
    }

    if (type === "meeting") {
      if (!doc?._id || !shouldPredictMeeting(doc)) {
        return { type, doc, predictionEligible: false, aiPriority: null };
      }
      return {
        type,
        doc,
        predictionEligible: true,
        featureRow: await buildMeetingFeatures(doc),
      };
    }

    return { type, doc, predictionEligible: false, aiPriority: null };
  }));

  const rowsToPredict = preparedItems
    .filter((item) => item.predictionEligible)
    .map((item) => item.featureRow);

  const predictedPriorities = await runBatchPrediction(rowsToPredict);

  let predictionIndex = 0;
  const results = [];
  for (const item of preparedItems) {
    const predictedPriority = item.predictionEligible
      ? predictedPriorities[predictionIndex++] || null
      : null;

    if (item.type === "followup" && item.doc?._id) {
      await Followup.updateOne(
        { _id: item.doc._id },
        { $set: { aiPriority: predictedPriority } }
      );
    }

    if (item.type === "meeting" && item.doc?._id) {
      await Meeting.updateOne(
        { _id: item.doc._id },
        { $set: { aiPriority: predictedPriority } }
      );
      if (item.doc.sourceFollowupId) {
        await Followup.updateOne(
          { _id: item.doc.sourceFollowupId },
          { $set: { aiPriority: predictedPriority } }
        );
      }
    }

    results.push({
      type: item.type,
      id: item.doc?._id ? String(item.doc._id) : null,
      aiPriority: predictedPriority,
    });
  }

  return results;
}

module.exports = {
  predictAndPersistFollowupPriority,
  predictAndPersistMeetingPriority,
  refreshPrioritiesForFollowupAndMeeting,
  predictAndPersistBatchPriorities,
  runBatchPrediction,
};
