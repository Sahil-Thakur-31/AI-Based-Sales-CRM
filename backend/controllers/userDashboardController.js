const mongoose = require("mongoose");
const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Meeting = require("../models/meetings");
const Event = require("../models/events");
const Followup = require("../models/followUp");
const SalesTarget = require("../models/sales_targets");

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

function getLeadPriority(lead) {
  const temp = String(lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return "High";
  if (temp === "warm") return "Medium";
  return "Low";
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

function normalizeRange(range) {
  const value = String(range || "month").toLowerCase();
  if (value === "week" || value === "quarter") return value;
  return "month";
}

function getRangeDates(range, now = new Date()) {
  const normalizedRange = normalizeRange(range);

  if (normalizedRange === "week") {
    return {
      range: normalizedRange,
      start: startOfWeek(now),
      end: nextDay(now),
      targetPeriodType: "monthly"
    };
  }

  if (normalizedRange === "quarter") {
    return {
      range: normalizedRange,
      start: startOfQuarter(now),
      end: nextQuarter(now),
      targetPeriodType: "quarterly"
    };
  }

  return {
    range: "month",
    start: startOfMonth(now),
    end: nextMonth(now),
    targetPeriodType: "monthly"
  };
}

function getRangeLabels(range) {
  if (range === "week") {
    return {
      followupsHeading: "This Week's Follow-ups & Meetings"
    };
  }

  if (range === "quarter") {
    return {
      followupsHeading: "This Quarter's Follow-ups & Meetings"
    };
  }

  return {
    followupsHeading: "This Month's Follow-ups & Meetings"
  };
}

function buildInsights({ followupsToday, staleLeads, highProbabilityDeals, winRate, monthlyAchievedPct }) {
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

  if (followupsToday === 0) {
    insights.push({
      id: "followups-clear",
      type: "Update",
      severity: "purple",
      message: "No follow-ups are due today."
    });
  }

  if (monthlyAchievedPct >= 100) {
    insights.push({
      id: "target-hit",
      type: "Momentum",
      severity: "green",
      message: "Monthly revenue target is already achieved."
    });
  } else if (winRate < 30) {
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
    const selectedRange = getRangeDates(req.query?.range, now);
    const rangeStart = selectedRange.start;
    const rangeEnd = selectedRange.end;
    const staleLeadCutoff = new Date(todayStart);
    staleLeadCutoff.setDate(staleLeadCutoff.getDate() - 7);

    const [
      followupDocs,
      meetings,
      activeDeals,
      newDealsThisWeek,
      dealStatusAgg,
      pipelineValueAgg,
      leadPipelineValueAgg,
      highProbabilityDeals,
      staleLeads,
      targetDoc,
      meetingsAgg,
      eventStatsAgg,
      upcomingMeetings,
      upcomingEvents,
      monthlyAchievedAgg
    ] = await Promise.all([
      Followup.find({
        assignedTo: assignedUserMatch,
        is_deleted: { $ne: true },
        dueDateTime: { $gte: rangeStart, $lt: rangeEnd }
      })
        .sort({ dueDateTime: 1, createdAt: -1 })
        .select("kind actionType title clientName dueDateTime priority status durationMinutes notes cancelReason")
        .lean(),
      Meeting.find({
        assignedTo: assignedUserMatch,
        is_deleted: { $ne: true },
        meetingDate: { $gte: rangeStart, $lt: rangeEnd },
        status: { $in: ["scheduled", "rescheduled", "completed"] }
      })
        .sort({ startTime: 1, createdAt: -1 })
        .limit(10)
        .select("title clientName startTime meetingDate priority status sourceFollowupId Id durationMinutes description cancelReason")
        .lean(),
      Deal.countDocuments({
        assignedTo: assignedUserMatch,
        status: "open",
        is_deleted: { $ne: true }
      }),
      Deal.countDocuments({
        assignedTo: assignedUserMatch,
        status: "open",
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
        is_deleted: { $ne: true }
      }),
      Deal.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
            is_deleted: { $ne: true }
          }
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$dealValue", 0] } }
          }
        }
      ]),
      Deal.aggregate([
        {
          $match: {
            assignedTo: assignedUserMatch,
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
            converted_to_deal: { $ne: true }
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
        status: "open",
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
        last_contact_date: { $lt: staleLeadCutoff }
      }),
      SalesTarget.findOne({
        user_id: userId,
        period_type: selectedRange.targetPeriodType,
        period_start: { $lte: now },
        period_end: { $gte: now }
      })
        .sort({ period_start: -1 })
        .lean(),
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
            status: "won",
            is_deleted: { $ne: true },
            $or: [
              { actualCloseDate: { $gte: rangeStart, $lt: rangeEnd } },
              {
                actualCloseDate: null,
                updatedAt: { $gte: rangeStart, $lt: rangeEnd }
              }
            ]
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$dealValue", 0] } }
          }
        }
      ])
    ]);

    const dealStatusMap = new Map(dealStatusAgg.map((item) => [String(item._id), item]));
    const wonDeals = dealStatusMap.get("won")?.count || 0;
    const lostDeals = dealStatusMap.get("lost")?.count || 0;
    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals ? Math.round((wonDeals / closedDeals) * 100) : 0;
    const dealPipelineValue = Number(pipelineValueAgg?.[0]?.total || 0);
    const leadPipelineValue = Number(leadPipelineValueAgg?.[0]?.total || 0);
    const pipelineValue = dealPipelineValue + leadPipelineValue;
    const monthlyTarget = Number(targetDoc?.revenue_target || 0);
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
    const rangeLabels = getRangeLabels(selectedRange.range);
    const summary = {
      followupsToday: mappedFollowups.length,
      meetingsToday: mappedMeetings.length || meetingLikeFollowups.length,
      highPriorityFollowups: mappedFollowups.filter((item) => item.priority === "High").length,
      activeDeals,
      dealsAddedThisWeek: newDealsThisWeek,
      monthlyTarget,
      monthlyAchieved,
      monthlyAchievedPct,
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
        value: summary.followupsToday + summary.meetingsToday,
        sub: `${summary.highPriorityFollowups} high priority follow-ups, ${summary.meetingsToday} meetings`,
        icon: "📞",
        color: "blue"
      },
      {
        title: "Active Deals",
        value: summary.activeDeals,
        sub: `+${summary.dealsAddedThisWeek} this ${selectedRange.range}`,
        icon: "💼",
        color: "green"
      },
      {
        title: "Target",
        value: formatCurrency(summary.monthlyTarget),
        sub: `${summary.monthlyAchievedPct}% achieved (${formatCurrency(summary.monthlyAchieved)})`,
        icon: "🎯",
        color: "orange"
      },
      {
        title: "Win Rate",
        value: `${summary.winRate}%`,
        sub: `${summary.wonDeals} won of ${summary.closedDeals} closed deals`,
        icon: "⭐",
        color: "purple"
      }
    ];

    return res.json({
      range: selectedRange.range,
      labels: rangeLabels,
      summary,
      statCards,
      followups: mappedFollowups,
      meetings: mappedMeetings,
      insights: buildInsights({
        followupsToday: mappedFollowups.length,
        staleLeads,
        highProbabilityDeals: highPriorityDeals,
        winRate,
        monthlyAchievedPct
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
