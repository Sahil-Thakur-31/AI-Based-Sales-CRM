const path = require("path");
const { spawn } = require("child_process");
const Deal = require("../models/deals");
const Leads = require("../models/leads");
const Followup = require("../models/followUp");
const Team = require("../models/teams");

const MODEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "Sales_Forecasting_Model",
  "model_artifacts",
  "sales_forecast_random_forest.joblib"
);
const BATCH_SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "Sales_Forecasting_Model",
  "predict_sales_forecast_batch.py"
);

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function startOfWeek(date = new Date()) {
  const value = startOfDay(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
}

function endOfWeek(date = new Date()) {
  const value = startOfWeek(date);
  value.setDate(value.getDate() + 6);
  return endOfDay(value);
}

function startOfMonth(date = new Date()) {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

function endOfMonth(date = new Date()) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function startOfQuarter(date = new Date()) {
  const month = date.getMonth();
  const quarterStartMonth = month - (month % 3);
  return startOfDay(new Date(date.getFullYear(), quarterStartMonth, 1));
}

function endOfQuarter(date = new Date()) {
  const start = startOfQuarter(date);
  return endOfDay(new Date(start.getFullYear(), start.getMonth() + 3, 0));
}

function normalizeRange(range) {
  const value = String(range || "").trim().toLowerCase();
  if (value === "week" || value === "this_week") return "week";
  if (value === "month" || value === "this_month") return "month";
  if (value === "quarter" || value === "this_quarter") return "quarter";
  return "all";
}

function getExpectedCloseDateFilter(range, now = new Date()) {
  const normalizedRange = normalizeRange(range);
  if (normalizedRange === "all") return null;

  if (normalizedRange === "week") {
    return {
      range: normalizedRange,
      expectedCloseDate: {
        $gte: startOfWeek(now),
        $lte: endOfWeek(now),
      },
    };
  }

  if (normalizedRange === "quarter") {
    return {
      range: normalizedRange,
      expectedCloseDate: {
        $gte: startOfQuarter(now),
        $lte: endOfQuarter(now),
      },
    };
  }

  return {
    range: "month",
    expectedCloseDate: {
      $gte: startOfMonth(now),
      $lte: endOfMonth(now),
    },
  };
}

function getRoleName(user = {}) {
  return String(user?.role || "").trim().toLowerCase();
}

function isPrivilegedUser(user = {}) {
  const roleName = getRoleName(user);
  return roleName === "admin" || roleName === "manager";
}

function isAdmin(user = {}) {
  return getRoleName(user) === "admin";
}

function isManager(user = {}) {
  return getRoleName(user) === "manager";
}

async function getAccessibleLeadIdsForUser(userId) {
  if (!userId) return [];
  return Leads.find({ assigned_to: userId }).distinct("_id");
}

async function getManagerTeamUserIds(userId) {
  if (!userId) return [];

  const teams = await Team.find({ "teamLeads.userId": userId })
    .select("teamLeads members")
    .lean();

  const userIds = new Set();
  for (const team of teams) {
    for (const lead of team.teamLeads || []) {
      if (lead?.userId) userIds.add(String(lead.userId));
    }
    for (const member of team.members || []) {
      if (member?.userId) userIds.add(String(member.userId));
    }
  }

  return [...userIds];
}

async function buildDealAccessFilter(user = {}, baseFilter = {}) {
  if (isAdmin(user)) return { ...baseFilter };

  if (isManager(user)) {
    const teamUserIds = await getManagerTeamUserIds(user?._id);
    const leadIds = teamUserIds.length
      ? await Leads.find({ assigned_to: { $in: teamUserIds } }).distinct("_id")
      : [];

    return {
      ...baseFilter,
      $or: [
        { assignedTo: { $in: teamUserIds } },
        { lead_id: { $in: leadIds } },
      ],
    };
  }

  const userId = user?._id || null;
  const leadIds = await getAccessibleLeadIdsForUser(userId);
  return {
    ...baseFilter,
    $or: [{ assignedTo: userId }, { lead_id: { $in: leadIds } }],
  };
}

function diffDays(fromValue, toValue) {
  const fromDate = fromValue ? new Date(fromValue) : null;
  const toDate = toValue ? new Date(toValue) : new Date();
  if (!fromDate || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 0;
  }
  return Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

function normalizeStage(stage) {
  const value = String(stage || "").trim().toUpperCase();
  return value || "P1";
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function summarizeDealActivity(followups = []) {
  let followupCount = 0;
  let meetingCount = 0;
  let overdueMeetingCount = 0;
  let overdueFollowupCount = 0;
  let latestCompletedContactAt = null;

  for (const item of followups) {
    const kind = String(item?.kind || "").toLowerCase();
    const status = String(item?.status || "").toLowerCase();
    const isCompleted = status === "completed";

    if (kind === "meeting") {
      if (isCompleted) meetingCount += 1;
      if (status === "overdue") overdueMeetingCount += 1;
    } else {
      if (isCompleted) followupCount += 1;
      if (status === "overdue") overdueFollowupCount += 1;
    }

    if (!isCompleted || !item?.completedAt) continue;

    const completedAt = new Date(item.completedAt);
    if (Number.isNaN(completedAt.getTime())) continue;

    if (!latestCompletedContactAt || completedAt > latestCompletedContactAt) {
      latestCompletedContactAt = completedAt;
    }
  }

  return {
    followupCount,
    meetingCount,
    overdueMeetingCount,
    overdueFollowupCount,
    latestCompletedContactAt,
  };
}

function buildModelInputRow({ deal, lead, activity }) {
  const dealValue = normalizeAmount(deal?.dealValue ?? lead?.deal_value_estimate);
  const dealAgeDays = diffDays(deal?.createdAt, new Date());
  const expectedCloseGapDays = deal?.expectedCloseDate ? diffDays(new Date(), deal.expectedCloseDate) : 0;
  const leadToDealConvertDays =
    lead?.created_at && deal?.createdAt ? diffDays(lead.created_at, deal.createdAt) : 0;
  const lastContactDays = activity.latestCompletedContactAt
    ? diffDays(activity.latestCompletedContactAt, new Date())
    : lead?.last_contact_date
      ? diffDays(lead.last_contact_date, new Date())
      : 0;

  return {
    dealId: String(deal?._id || ""),
    name: deal?.deal_name || "Untitled Deal",
    companyName: lead?.company_name || "",
    stage: normalizeStage(deal?.stage || lead?.stage),
    amount: dealValue,
    deal_stage: normalizeStage(deal?.stage || lead?.stage),
    deal_value: dealValue,
    overdue_meeting_count: activity.overdueMeetingCount,
    // Keep the legacy field on the payload so older saved models can still score
    // while the project moves to the retrained overdue_meeting_count model.
    deal_age_days: dealAgeDays,
    expected_close_gap_days: expectedCloseGapDays,
    lead_to_deal_convert_days: leadToDealConvertDays,
    followup_count: activity.followupCount,
    meeting_count: activity.meetingCount,
    overdue_followup_count: activity.overdueFollowupCount,
    last_contact_days: lastContactDays,
  };
}

function logModelInputs(rows = [], dealsById = new Map(), leadsById = new Map()) {
  const printableRows = rows.map((row) => {
    const deal = dealsById.get(String(row.dealId)) || {};
    const lead = deal?.lead_id ? leadsById.get(String(deal.lead_id)) || {} : {};
    const cliArgs = [
      `--deal_stage ${row.deal_stage}`,
      `--deal_value ${row.deal_value}`,
      `--overdue_meeting_count ${row.overdue_meeting_count}`,
      `--expected_close_gap_days ${row.expected_close_gap_days}`,
      `--lead_to_deal_convert_days ${row.lead_to_deal_convert_days}`,
      `--followup_count ${row.followup_count}`,
      `--meeting_count ${row.meeting_count}`,
      `--overdue_followup_count ${row.overdue_followup_count}`,
      `--last_contact_days ${row.last_contact_days}`,
    ].join(" ");

    return {
      dealId: row.dealId,
      dealName: row.name,
      companyName: row.companyName,
      modelInputArgs: cliArgs,
      "db:deals.stage -> model:deal_stage": row.deal_stage,
      "db:deals.expectedCloseDate -> model:expected_close_gap_days": row.expected_close_gap_days,
      "db:leads.created_at + deals.createdAt -> model:lead_to_deal_convert_days":
        row.lead_to_deal_convert_days,
      "db:followups(kind=followup,status=completed) -> model:followup_count": row.followup_count,
      "db:followups(kind=meeting,status=completed) -> model:meeting_count": row.meeting_count,
      "db:followups(kind=meeting,status=overdue) -> model:overdue_meeting_count":
        row.overdue_meeting_count,
      "db:followups(kind=followup,status=overdue) -> model:overdue_followup_count":
        row.overdue_followup_count,
      "db:latest followups.completedAt where status=completed or leads.last_contact_date -> model:last_contact_days":
        row.last_contact_days,
      "db:deals.dealValue or leads.deal_value_estimate -> revenue only:deal_value": row.deal_value,
      "raw:deals.stage": deal?.stage ?? null,
      "raw:deals.expectedCloseDate": deal?.expectedCloseDate ?? null,
      "raw:deals.createdAt": deal?.createdAt ?? null,
      "raw:leads.created_at": lead?.created_at ?? null,
      "raw:leads.last_contact_date": lead?.last_contact_date ?? null,
      "raw:deals.dealValue": deal?.dealValue ?? null,
      "raw:leads.deal_value_estimate": lead?.deal_value_estimate ?? null,
    };
  });

  if (process.env.SALES_FORECAST_DEBUG === "true") {
    console.log("Sales forecast model inputs:");
    for (const row of printableRows) {
      console.log(`[Sales Forecast] ${row.dealName} (${row.dealId})`);
      console.log(row.modelInputArgs);
    }
  }
}

function runBatchPrediction(inputRows) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [BATCH_SCRIPT_PATH, "--model-path", MODEL_PATH], {
      cwd: path.resolve(__dirname, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Prediction process exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse prediction output: ${error.message}`));
      }
    });

    child.stdin.write(JSON.stringify({ deals: inputRows }));
    child.stdin.end();
  });
}

function groupPipeline(items = []) {
  const stageOrder = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
  const stageMap = new Map();

  for (const stage of stageOrder) {
    stageMap.set(stage, {
      stageKey: stage,
      stageLabel: stage,
      value: 0,
      deals: 0,
      items: [],
    });
  }

  for (const item of items) {
    const stageKey = normalizeStage(item?.stage);
    if (!stageMap.has(stageKey)) {
      stageMap.set(stageKey, {
        stageKey,
        stageLabel: stageKey,
        value: 0,
        deals: 0,
        items: [],
      });
    }

    const bucket = stageMap.get(stageKey);
    bucket.value += normalizeAmount(item.amount);
    bucket.deals += 1;
    bucket.items.push(item);
  }

  return [...stageMap.values()].filter((bucket) => bucket.deals > 0);
}

async function getSalesForecast(user = {}, options = {}) {
  const baseFilter = {
    is_deleted: { $ne: true },
    stage: { $nin: ["P6", "P7"] },
    isActive: { $ne: false },
  };
  const rangeFilter = getExpectedCloseDateFilter(options?.range);
  const scopedBaseFilter = rangeFilter
    ? { ...baseFilter, expectedCloseDate: rangeFilter.expectedCloseDate }
    : baseFilter;
  const accessFilter = await buildDealAccessFilter(user, scopedBaseFilter);
  const deals = await Deal.find(accessFilter)
    .select(
      "_id deal_name assignedTo stage dealValue expectedCloseDate aiRiskScore lead_id createdAt updatedAt"
    )
    .sort({ updatedAt: -1 })
    .lean();

  if (!deals.length) {
    return {
      summary: {
        totalPipelineValue: 0,
        totalActiveDeals: 0,
        expectedWinRate: 0,
        forecastRevenue: 0,
        avgSalesCycleDays: 0,
        modelName: "Random Forest",
        selectedRange: rangeFilter?.range || "all",
      },
      pipeline: [],
      generatedAt: new Date().toISOString(),
      range: rangeFilter?.range || "all",
    };
  }

  const leadIds = [...new Set(deals.map((deal) => String(deal.lead_id || "")).filter(Boolean))];
  const dealIds = deals.map((deal) => deal._id);

  const [leads, followups] = await Promise.all([
    leadIds.length ? Leads.find({ _id: { $in: leadIds } }).lean() : [],
    Followup.find({
      dealId: { $in: dealIds },
      is_deleted: { $ne: true },
    })
      .select("dealId kind status lastContactDate completedAt createdAt updatedAt")
      .lean(),
  ]);

  const leadMap = new Map(leads.map((lead) => [String(lead._id), lead]));
  const dealMap = new Map(deals.map((deal) => [String(deal._id), deal]));
  const activityMap = new Map();

  for (const row of followups) {
    const dealId = String(row?.dealId || "");
    if (!dealId) continue;
    const bucket = activityMap.get(dealId) || [];
    bucket.push(row);
    activityMap.set(dealId, bucket);
  }

  const inputRows = deals.map((deal) => {
    const dealId = String(deal._id);
    const lead = deal?.lead_id ? leadMap.get(String(deal.lead_id)) : null;
    const activity = summarizeDealActivity(activityMap.get(dealId) || []);
    return buildModelInputRow({ deal, lead, activity });
  });

  logModelInputs(inputRows, dealMap, leadMap);

  const predictionResponse = await runBatchPrediction(inputRows);
  const predictions = Array.isArray(predictionResponse?.predictions)
    ? predictionResponse.predictions
    : [];
  const predictionMap = new Map(predictions.map((row) => [String(row.dealId || ""), row]));

  const pipelineItems = inputRows.map((row) => {
    const prediction = predictionMap.get(row.dealId) || {};
    return {
      _id: row.dealId,
      name: row.name,
      companyName: row.companyName,
      stage: row.stage,
      amount: row.amount,
      winProbability: normalizeAmount(prediction.win_probability_percent),
      forecastRevenueContribution: normalizeAmount(prediction.forecast_revenue_contribution),
    };
  });

  // Save predictions to each deal in the database
  try {
    for (const item of pipelineItems) {
      const prediction = predictionMap.get(item._id) || {};
      const predictedLabel = prediction.predicted_label !== undefined ? prediction.predicted_label : null;
      
      await Deal.findByIdAndUpdate(
        item._id,
        {
          forecast: {
            predictedLabel: predictedLabel,
            predictedLabelText: predictedLabel === 1 ? "won" : predictedLabel === 0 ? "lost" : null,
            winProbability: normalizeAmount(prediction.win_probability) || 0,
            winProbabilityPercent: normalizeAmount(prediction.win_probability_percent) || 0,
            forecastRevenue: normalizeAmount(prediction.forecast_revenue_contribution) || 0,
            generatedAt: new Date(),
            modelVersion: "random_forest_v1"
          }
        },
        { returnDocument: "before" }
      );
    }
  } catch (error) {
    console.error("Error saving forecast predictions to deals:", error);
    // Continue without failing - predictions will still be returned in the response
  }

  const totalPipelineValue = pipelineItems.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
  const forecastRevenue = pipelineItems.reduce(
    (sum, item) => sum + normalizeAmount(item.forecastRevenueContribution),
    0
  );
  const expectedWinRate =
    pipelineItems.length > 0
      ? pipelineItems.reduce((sum, item) => sum + normalizeAmount(item.winProbability), 0) /
        pipelineItems.length
      : 0;
  const avgSalesCycleDays =
    inputRows.length > 0
      ? inputRows.reduce((sum, row) => sum + normalizeAmount(row.lead_to_deal_convert_days), 0) /
        inputRows.length
      : 0;

  return {
    summary: {
      totalPipelineValue,
      totalActiveDeals: pipelineItems.length,
      expectedWinRate,
      forecastRevenue,
      avgSalesCycleDays,
      modelName: predictionResponse?.model_name || "Random Forest",
      selectedRange: rangeFilter?.range || "all",
    },
    pipeline: groupPipeline(pipelineItems),
    generatedAt: new Date().toISOString(),
    range: rangeFilter?.range || "all",
  };
}

module.exports = {
  getSalesForecast,
};
