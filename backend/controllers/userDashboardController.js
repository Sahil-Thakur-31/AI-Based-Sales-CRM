const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Meeting = require("../models/meetings");
const Event = require("../models/events");
const Followup = require("../models/followUp");
const SalesTarget = require("../models/sales_targets");

const DEAL_WON_STAGE = "P7";
const DEAL_LOST_STAGE = "P6";
const OPEN_DEAL_STAGE_FILTER = { $nin: [DEAL_WON_STAGE, DEAL_LOST_STAGE] };
const ACTIVE_DEAL_PIPELINE_STAGES = ["P1", "P2", "P3"];
const ACTIVE_LEAD_PIPELINE_STAGES = ["P1", "P2", "P3", "P5"];
const EXCLUDED_ACTIVE_LEAD_STAGES = ["P4", "P6", "P7"];

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date = new Date()) {
  const value = startOfDay(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextDay(date = new Date()) {
  const value = startOfDay(date);
  value.setDate(value.getDate() + 1);
  return value;
}

function nextMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function startOfQuarter(date = new Date()) {
  const month = date.getMonth();
  const quarterStartMonth = month - (month % 3);
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function nextQuarter(date = new Date()) {
  const start = startOfQuarter(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 1);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.round(value)));
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  });
}

function getFollowupPriority(priority) {
  const value = String(priority || "").toLowerCase();
  if (value === "high" || value === "urgent") return "High";
  if (value === "medium") return "Medium";
  return "Low";
}

function isMeetingLikeFollowup(doc) {
  if (!doc) return false;
  if (String(doc.kind || "").toLowerCase() === "meeting") return true;
  return String(doc.actionType || "").toLowerCase().includes("meeting");
}

function mapFollowupStatusToMeetingBucket(status) {
  const value = String(status || "").toLowerCase();
  if (value === "completed") return "completed";
  if (value === "cancelled") return "cancelled";
  return "scheduled";
}

function canAccessDashboard(role) {
  const value = String(role || "").toLowerCase();
  return (
    value === "user" ||
    value === "sales person" ||
    value === "salesperson" ||
    value === "sales" ||
    value === "manager" ||
    value === "admin"
  );
}

function isCancelledLikeStatus(status) {
  const value = String(status || "").toLowerCase();
  return value === "cancelled" || value === "canceled" || value === "no_show";
}

function isOverdueLikeStatus(status) {
  return String(status || "").toLowerCase() === "overdue";
}

function isTimelineItemOverdueOrCancelled(item, now = new Date()) {
  const status = String(item?.status || "").toLowerCase();
  if (isCancelledLikeStatus(status) || isOverdueLikeStatus(status)) return true;
  const dueAt = item?.dueAt ? new Date(item.dueAt) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return false;
  if (item?.kind === "meeting") {
    return ["scheduled", "rescheduled"].includes(status) && dueAt < now;
  }
  return status === "pending" && dueAt < now;
}

function buildClosedDealRangeMatch(rangeStart, rangeEnd) {
  return {
    $or: [
      { actualCloseDate: { $gte: rangeStart, $lt: rangeEnd } },
      {
        actualCloseDate: null,
        updatedAt: { $gte: rangeStart, $lt: rangeEnd }
      }
    ]
  };
}

async function getRevenueTargetForRange(userId, selectedRange) {
  const baseMatch = {
    user_id: userId,
    status: { $ne: "archived" }
  };

  const aggregateTargetForPeriod = async (periodType) => {
    const result = await SalesTarget.aggregate([
      {
        $match: {
          ...baseMatch,
          period_type: periodType,
          period_start: { $gte: selectedRange.start },
          period_end: { $lte: selectedRange.end }
        }
      },
      { $sort: { period_start: 1, updated_at: -1, created_at: -1 } },
      {
        $group: {
          _id: {
            period_start: "$period_start",
            period_end: "$period_end"
          },
          revenueTarget: { $first: { $ifNull: ["$revenue_target", 0] } }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$revenueTarget" },
          count: { $sum: 1 }
        }
      }
    ]);

    return {
      total: Number(result?.[0]?.total || 0),
      count: Number(result?.[0]?.count || 0)
    };
  };

  if (selectedRange.targetPeriodType === "yearly") {
    const quarterly = await aggregateTargetForPeriod("quarterly");
    if (quarterly.count > 0) return quarterly.total;

    const monthly = await aggregateTargetForPeriod("monthly");
    return monthly.total;
  }

  const targetDoc = await SalesTarget.findOne({
    ...baseMatch,
    period_type: selectedRange.targetPeriodType,
    period_start: { $lte: selectedRange.start },
    period_end: { $gte: selectedRange.start }
  })
    .sort({ period_start: -1, updated_at: -1, created_at: -1 })
    .lean();

  return Number(targetDoc?.revenue_target || 0);
}

function normalizeRange(range) {
  const value = String(range || "month").toLowerCase();
  if (value === "week" || value === "quarter") return value;
  return "month";
}

function normalizeMonth(month, fallbackMonth) {
  const numericMonth = Number(month);
  if (!Number.isInteger(numericMonth)) return fallbackMonth;
  if (numericMonth >= 1 && numericMonth <= 12) return numericMonth - 1;
  if (numericMonth >= 0 && numericMonth <= 11) return numericMonth;
  return fallbackMonth;
}

function normalizeYear(year, fallbackYear) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear)) return fallbackYear;
  if (numericYear < 2000 || numericYear > 2100) return fallbackYear;
  return numericYear;
}

function normalizeQuarter(quarter, fallbackQuarter = "q1") {
  const value = String(quarter || fallbackQuarter).toLowerCase();
  return ["q1", "q2", "q3", "q4"].includes(value) ? value : fallbackQuarter;
}

function quarterStartMonthFromValue(quarter) {
  if (quarter === "q2") return 3;
  if (quarter === "q3") return 6;
  if (quarter === "q4") return 9;
  return 0;
}

function getRangeDates(range, options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date();
  const period = String(options.period || "").toLowerCase();
  const normalizedRange = period === "quarterly"
    ? "quarter"
    : period === "yearly"
      ? "year"
      : normalizeRange(range);
  const selectedMonth = normalizeMonth(options.month, now.getMonth());
  const selectedYear = normalizeYear(options.year, now.getFullYear());
  const selectedQuarter = normalizeQuarter(options.quarter, `q${Math.floor(now.getMonth() / 3) + 1}`);
  const selectedMonthDate = new Date(selectedYear, selectedMonth, 1);
  const selectedQuarterDate = new Date(selectedYear, quarterStartMonthFromValue(selectedQuarter), 1);

  if (normalizedRange === "week") {
    return {
      range: normalizedRange,
      start: startOfWeek(now),
      end: nextDay(now),
      targetPeriodType: "monthly",
      label: "This Week"
    };
  }

  if (normalizedRange === "quarter") {
    const label = `${selectedQuarter.toUpperCase()} (${selectedQuarter === "q1" ? "Jan-Mar" : selectedQuarter === "q2" ? "Apr-Jun" : selectedQuarter === "q3" ? "Jul-Sep" : "Oct-Dec"}) ${selectedYear}`;
    return {
      range: normalizedRange,
      start: startOfQuarter(selectedQuarterDate),
      end: nextQuarter(selectedQuarterDate),
      targetPeriodType: "quarterly",
      label
    };
  }

  if (normalizedRange === "year") {
    return {
      range: normalizedRange,
      start: new Date(selectedYear, 0, 1),
      end: new Date(selectedYear + 1, 0, 1),
      targetPeriodType: "yearly",
      label: String(selectedYear)
    };
  }

  const label = selectedMonthDate.toLocaleString("en-IN", {
    month: "long",
    year: "numeric"
  });

  return {
    range: "month",
    start: startOfMonth(selectedMonthDate),
    end: nextMonth(selectedMonthDate),
    targetPeriodType: "monthly",
    label
  };
}

function getRangeLabels(range, label = "") {
  if (range === "week") {
    return {
      followupsHeading: "This Week's Follow-ups & Meetings"
    };
  }

  if (range === "quarter") {
    return {
      followupsHeading: label ? `${label} Follow-ups & Meetings` : "This Quarter's Follow-ups & Meetings"
    };
  }

  if (range === "year") {
    return {
      followupsHeading: label ? `${label} Follow-ups & Meetings` : "This Year's Follow-ups & Meetings"
    };
  }

  return {
    followupsHeading: label ? `${label} Follow-ups & Meetings` : "This Month's Follow-ups & Meetings"
  };
}

function buildInsights({
  followupsDueToday,
  staleLeads,
  highProbabilityDeals,
  winRate,
  closedDeals,
  revenueAchievedPct
}) {
  const insights = [];

  if (highProbabilityDeals.length) {
    const bestDeal = highProbabilityDeals[0];
    insights.push({
      id: `deal-${bestDeal._id}`,
      type: "Opportunity",
      severity: "green",
      message: `${bestDeal.clientName} is at ${Math.round(bestDeal.probability || 0)}% close probability.`
    });
  }

  if (staleLeads > 0) {
    insights.push({
      id: "stale-leads",
      type: "Risk",
      severity: "red",
      message: `${staleLeads} lead${staleLeads === 1 ? "" : "s"} haven't been contacted in 7+ days.`
    });
  }

  if (followupsDueToday === 0) {
    insights.push({
      id: "followups-clear",
      type: "Update",
      severity: "purple",
      message: "No follow-ups are due today."
    });
  }

  if (revenueAchievedPct >= 100) {
    insights.push({
      id: "target-hit",
      type: "Momentum",
      severity: "green",
      message: "Revenue target for the active target window is already achieved."
    });
  } else if (closedDeals > 0 && winRate < 30) {
    insights.push({
      id: "win-rate",
      type: "Action",
      severity: "purple",
      message: "Win rate is below 30%. Review qualification and proposal conversion."
    });
  }

  if (!insights.length) {
    insights.push({
      id: "steady",
      type: "Status",
      severity: "purple",
      message: "Pipeline activity looks stable. Keep pushing today's follow-ups."
    });
  }

  return insights.slice(0, 3);
}

function buildSafeArraySize(fieldName) {
  return {
    $size: {
      $cond: [{ $isArray: fieldName }, fieldName, []]
    }
  };
}

function buildAssignedUserMatch(userId) {
  const rawUserId = String(userId || "");
  const values = [rawUserId];

  if (mongoose.Types.ObjectId.isValid(rawUserId)) {
    values.push(new mongoose.Types.ObjectId(rawUserId));
  }

  return { $in: values };
}

exports.getDashboard = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!canAccessDashboard(req.user.role)) {
      return res.status(403).json({ message: "Only users, managers, and admins can view this dashboard" });
    }

    const userId = req.user._id;
    const assignedUserMatch = buildAssignedUserMatch(userId);
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrow = nextDay(now);
    const selectedRange = getRangeDates(req.query?.range, {
      period: req.query?.period,
      now,
      month: req.query?.month,
      quarter: req.query?.quarter,
      year: req.query?.year
    });
    const rangeStart = selectedRange.start;
    const rangeEnd = selectedRange.end;
    const staleLeadCutoff = new Date(todayStart);
    staleLeadCutoff.setDate(staleLeadCutoff.getDate() - 7);
    const closedDealRangeMatch = buildClosedDealRangeMatch(rangeStart, rangeEnd);

    const [
      followupDocs,
      meetings,
      activeDeals,
      activeLeads,
      newDealsThisWeek,
      closedStageAgg,
      pipelineValueAgg,
      leadPipelineValueAgg,
      highProbabilityDeals,
      staleLeads,
      meetingsAgg,
      eventStatsAgg,
      upcomingMeetings,
      upcomingEvents,
      monthlyAchievedAgg,
      monthlyTarget
    ] = await Promise.all([
      Followup.find({
        assignedTo: assignedUserMatch,
        is_deleted: { $ne: true },
        dueDateTime: { $gte: rangeStart, $lt: rangeEnd }
      })
        .sort({ dueDateTime: 1, createdAt: -1 })
        .select("kind actionType title clientName dueDateTime priority aiPriority status durationMinutes notes cancelReason")
        .lean(),
      Meeting.find({
        assignedTo: assignedUserMatch,
        is_deleted: { $ne: true },
        meetingDate: { $gte: rangeStart, $lt: rangeEnd },
        status: { $in: ["scheduled", "rescheduled", "completed", "cancelled", "no_show"] }
      })
        .sort({ startTime: 1, createdAt: -1 })
        .select("title clientName startTime meetingDate priority aiPriority status sourceFollowupId Id durationMinutes description cancelReason")
        .lean(),
      Deal.countDocuments({
        assignedTo: assignedUserMatch,
        stage: { $in: ACTIVE_DEAL_PIPELINE_STAGES },
        isActive: { $ne: false },
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
        is_deleted: { $ne: true }
      }),
      Lead.countDocuments({
        assigned_to: assignedUserMatch,
        is_deleted: { $ne: true },
        converted_to_deal: { $ne: true },
        is_active: true,
        stage: { $nin: EXCLUDED_ACTIVE_LEAD_STAGES },
        created_at: { $gte: rangeStart, $lt: rangeEnd }
      }),
      Deal.countDocuments({
        assignedTo: assignedUserMatch,
        stage: { $in: ACTIVE_DEAL_PIPELINE_STAGES },
        isActive: { $ne: false },
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
        is_deleted: { $ne: true }
      }),
      Deal.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
            is_deleted: { $ne: true },
            stage: { $in: [DEAL_WON_STAGE, DEAL_LOST_STAGE] },
            ...closedDealRangeMatch
          }
        },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 }
          }
        }
      ]),
      Deal.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
            isActive: { $ne: false },
            stage: { $in: ACTIVE_DEAL_PIPELINE_STAGES },
            createdAt: { $gte: rangeStart, $lt: rangeEnd },
            is_deleted: { $ne: true }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$dealValue", 0] } }
          }
        }
      ]),
      Lead.aggregate([
        {
          $match: {
            assigned_to: assignedUserMatch,
            is_deleted: { $ne: true },
            converted_to_deal: { $ne: true },
            is_active: true,
            stage: { $in: ACTIVE_LEAD_PIPELINE_STAGES },
            created_at: { $gte: rangeStart, $lt: rangeEnd }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$deal_value_estimate", 0] } }
          }
        }
      ]),
      Deal.find({
        assignedTo: assignedUserMatch,
        stage: OPEN_DEAL_STAGE_FILTER,
        probability: { $gte: 70 },
        is_deleted: { $ne: true }
      })
        .sort({ probability: -1, dealValue: -1 })
        .limit(3)
        .populate("client_id", "name")
        .select("probability client_id")
        .lean(),
      Lead.countDocuments({
        assigned_to: assignedUserMatch,
        is_deleted: { $ne: true },
        converted_to_deal: { $ne: true },
        is_active: true,
        stage: { $nin: EXCLUDED_ACTIVE_LEAD_STAGES },
        last_contact_date: { $lt: staleLeadCutoff }
      }),
      Meeting.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
            is_deleted: { $ne: true },
            meetingDate: { $gte: rangeStart, $lt: rangeEnd }
          }
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      Event.aggregate([
        {
          $match: {
            is_deleted: false,
            startDate: { $gte: rangeStart, $lt: rangeEnd }
          }
        },
        {
          $project: {
            status: 1,
            registeredCount: buildSafeArraySize("$registeredBy"),
            attendedCount: buildSafeArraySize("$attendedBy")
          }
        },
        {
          $project: {
            registeredCount: 1,
            attendedCount: 1,
            missedCount: {
              $cond: [
                { $eq: ["$status", "completed"] },
                { $max: [{ $subtract: ["$registeredCount", "$attendedCount"] }, 0] },
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            registeredEvents: { $sum: "$registeredCount" },
            attendedEvents: { $sum: "$attendedCount" },
            missedEvents: { $sum: "$missedCount" }
          }
        }
      ]),
      Meeting.countDocuments({
        assignedTo: assignedUserMatch,
        is_deleted: { $ne: true },
        meetingDate: { $gte: now },
        status: { $in: ["scheduled", "rescheduled"] }
      }),
      Event.countDocuments({
        is_deleted: false,
        status: "upcoming",
        startDate: { $gte: now }
      }),
      Deal.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
            stage: DEAL_WON_STAGE,
            is_deleted: { $ne: true },
            ...closedDealRangeMatch
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$dealValue", 0] } }
          }
        }
      ]),
      getRevenueTargetForRange(userId, selectedRange)
    ]);

    const closedStageMap = new Map(closedStageAgg.map((item) => [String(item._id), item.count]));
    const wonDeals = closedStageMap.get(DEAL_WON_STAGE) || 0;
    const lostDeals = closedStageMap.get(DEAL_LOST_STAGE) || 0;
    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals ? Math.round((wonDeals / closedDeals) * 100) : 0;
    const dealPipelineValue = Number(pipelineValueAgg?.[0]?.total || 0);
    const leadPipelineValue = Number(leadPipelineValueAgg?.[0]?.total || 0);
    const pipelineValue = dealPipelineValue + leadPipelineValue;
    const monthlyAchieved = Number(monthlyAchievedAgg?.[0]?.total || 0);
    const monthlyAchievedPct = monthlyTarget
      ? clampPercent((monthlyAchieved / monthlyTarget) * 100)
      : 0;

    const followupItems = followupDocs.filter((doc) => !isMeetingLikeFollowup(doc));
    const meetingLikeFollowups = followupDocs.filter((doc) => isMeetingLikeFollowup(doc));
    const mappedFollowups = followupItems.map((doc) => ({
      id: doc._id,
      actionId: doc._id,
      kind: "followup",
      company: doc.clientName || "Unknown company",
      message: doc.title || doc.actionType || "Follow up",
      dueAt: doc.dueDateTime || null,
      priority: getFollowupPriority(doc.priority),
      aiPriority: doc.aiPriority || null,
      status: doc.status || "pending",
      durationMinutes: doc.durationMinutes || "",
      notes: doc.cancelReason || doc.notes || "",
      cancelReason: doc.cancelReason || ""
    }));
    const mappedMeetings = meetings.map((meeting) => ({
      id: meeting._id,
      actionId: meeting.sourceFollowupId || meeting.Id || meeting._id,
      kind: "meeting",
      company: meeting.clientName || "Scheduled meeting",
      message: meeting.title || "Meeting",
      dueAt: meeting.startTime || meeting.meetingDate || null,
      priority: String(meeting.priority || "medium").replace(/^./, (char) => char.toUpperCase()),
      aiPriority: meeting.aiPriority || null,
      status: meeting.status || "scheduled",
      durationMinutes: meeting.durationMinutes || "",
      notes: meeting.cancelReason || meeting.description || "",
      cancelReason: meeting.cancelReason || ""
    }));

    const highPriorityDeals = highProbabilityDeals.map((deal) => ({
      _id: deal._id,
      probability: Number(deal.probability || 0),
      clientName: deal.client_id?.name || "A deal"
    }));

    const meetingStatusMap = new Map(meetingsAgg.map((item) => [String(item._id), item.count]));
    const scheduledMeetings =
      (meetingStatusMap.get("scheduled") || 0) + (meetingStatusMap.get("rescheduled") || 0);
    const completedMeetings = meetingStatusMap.get("completed") || 0;
    const cancelledMeetings =
      (meetingStatusMap.get("cancelled") || 0) + (meetingStatusMap.get("no_show") || 0);
    const fallbackMeetingStatusCounts = meetingLikeFollowups.reduce(
      (acc, doc) => {
        const bucket = mapFollowupStatusToMeetingBucket(doc.status);
        acc[bucket] += 1;
        return acc;
      },
      { scheduled: 0, completed: 0, cancelled: 0 }
    );
    const meetingStatusTotal = scheduledMeetings + completedMeetings + cancelledMeetings;
    const resolvedScheduledMeetings =
      meetingStatusTotal > 0 ? scheduledMeetings : fallbackMeetingStatusCounts.scheduled;
    const resolvedCompletedMeetings =
      meetingStatusTotal > 0 ? completedMeetings : fallbackMeetingStatusCounts.completed;
    const resolvedCancelledMeetings =
      meetingStatusTotal > 0 ? cancelledMeetings : fallbackMeetingStatusCounts.cancelled;
    const registeredEvents = Number(eventStatsAgg?.[0]?.registeredEvents || 0);
    const attendedEvents = Number(eventStatsAgg?.[0]?.attendedEvents || 0);
    const missedEvents = Number(eventStatsAgg?.[0]?.missedEvents || 0);
    const totalMeetings =
      resolvedScheduledMeetings + resolvedCompletedMeetings + resolvedCancelledMeetings;
    const totalEvents = registeredEvents + attendedEvents + missedEvents;
    const rangeLabels = getRangeLabels(selectedRange.range, selectedRange.label);
    const filteredTimelineFollowups = mappedFollowups;
    const filteredTimelineMeetings = mappedMeetings;
    const followupsDueToday = mappedFollowups.filter((item) => {
      const dueAt = item.dueAt ? new Date(item.dueAt) : null;
      if (!dueAt || Number.isNaN(dueAt.getTime())) return false;
      return dueAt >= todayStart && dueAt < tomorrow;
    }).length;
    const meetingsDueToday = mappedMeetings.filter((item) => {
      const dueAt = item.dueAt ? new Date(item.dueAt) : null;
      if (!dueAt || Number.isNaN(dueAt.getTime())) return false;
      return dueAt >= todayStart && dueAt < tomorrow;
    }).length;
    const meetingsInRange = filteredTimelineMeetings.length;
    const summary = {
      followupsToday: followupsDueToday,
      followupsInRange: filteredTimelineFollowups.length,
      meetingsToday: meetingsDueToday,
      meetingsInRange,
      highPriorityFollowups: filteredTimelineFollowups.filter((item) => item.priority === "High").length,
      activeDeals,
      activeLeads,
      dealsAddedThisWeek: newDealsThisWeek,
      monthlyTarget,
      monthlyAchieved,
      monthlyAchievedPct,
      revenueAchieved: monthlyAchieved,
      revenueAchievedPct: monthlyAchievedPct,
      winRate,
      wonDeals,
      closedDeals,
      dealPipelineValue,
      leadPipelineValue,
      pipelineValue
    };
    const statCards = [
      {
        title: "Follow-ups & Meetings",
        value: summary.followupsInRange + summary.meetingsInRange,
        sub: `${summary.followupsInRange} follow-ups and ${summary.meetingsInRange} meetings in ${selectedRange.label || selectedRange.range}`,
        icon: "📞",
        color: "blue"
      },
      {
        title: "Active Deals",
        value: summary.activeDeals,
        sub: `${summary.dealsAddedThisWeek} new deals added in ${selectedRange.label || selectedRange.range}`,
        icon: "💼",
        color: "green"
      },
      {
        title: "Active Leads",
        value: summary.activeLeads,
        sub: `Active leads created in ${selectedRange.label || selectedRange.range}`,
        icon: "🧲",
        color: "cyan"
      },
      {
        title: "Target",
        value: formatCurrency(summary.monthlyTarget),
        sub: `${summary.monthlyAchievedPct}% of target achieved, totaling ${formatCurrency(summary.monthlyAchieved)}`,
        icon: "🎯",
        color: "orange"
      },
      {
        title: "Win Rate",
        value: `${summary.winRate}%`,
        sub: `${summary.wonDeals} wins from ${summary.closedDeals} closed deals`,
        icon: "⭐",
        color: "purple"
      }
    ];

    return res.json({
      range: selectedRange.range,
      labels: rangeLabels,
      summary,
      statCards,
      followups: filteredTimelineFollowups,
      meetings: filteredTimelineMeetings,
      insights: buildInsights({
        followupsDueToday,
        staleLeads,
        highProbabilityDeals: highPriorityDeals,
        winRate,
        closedDeals,
        revenueAchievedPct: monthlyAchievedPct
      }),
      activity: {
        meetings: [
          { name: "Scheduled", value: resolvedScheduledMeetings },
          { name: "Conducted", value: resolvedCompletedMeetings },
          { name: "Cancelled", value: resolvedCancelledMeetings }
        ],
        events: [
          { name: "Registered", value: registeredEvents },
          { name: "Attended", value: attendedEvents },
          { name: "Missed", value: missedEvents }
        ],
        footerStats: {
          meetingRate: totalMeetings ? clampPercent((resolvedCompletedMeetings / totalMeetings) * 100) : 0,
          eventAttendance: registeredEvents ? clampPercent((attendedEvents / registeredEvents) * 100) : 0,
          totalActivities: totalMeetings + totalEvents,
          upcoming: upcomingMeetings + upcomingEvents
        }
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load manager dashboard" });
  }
};
