const Deal = require("../models/deals");
const Lead = require("../models/leads");
const Meeting = require("../models/meetings");
const Event = require("../models/events");
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

function getLeadPriority(lead) {
  const temp = String(lead?.lead_temperature || "").toLowerCase();
  if (temp === "hot") return "High";
  if (temp === "warm") return "Medium";
  return "Low";
}

function canAccessDashboard(role) {
  const value = String(role || "").toLowerCase();
  return value === "manager" || value === "admin";
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

exports.getDashboard = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!canAccessDashboard(req.user.role)) {
      return res.status(403).json({ message: "Only managers and admins can view this dashboard" });
    }

    const userId = req.user._id;
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrow = nextDay(now);
    const selectedRange = getRangeDates(req.query?.range, now);
    const rangeStart = selectedRange.start;
    const rangeEnd = selectedRange.end;
    const staleLeadCutoff = new Date(todayStart);
    staleLeadCutoff.setDate(staleLeadCutoff.getDate() - 7);

    const [
      followupLeads,
      meetings,
      activeDeals,
      newDealsThisWeek,
      dealStatusAgg,
      highProbabilityDeals,
      staleLeads,
      targetDoc,
      meetingsAgg,
      registeredEvents,
      attendedEvents,
      missedEvents,
      upcomingMeetings,
      upcomingEvents,
      monthlyAchievedAgg
    ] = await Promise.all([
      Lead.find({
        assigned_to: userId,
        last_contact_date: { $gte: rangeStart, $lt: rangeEnd },
        is_deleted: { $ne: true }
      })
        .sort({ last_contact_date: 1 })
        .select("company_name next_action last_contact_date lead_temperature")
        .lean(),
      Meeting.find({
        assignedTo: userId,
        is_deleted: { $ne: true },
        meetingDate: { $gte: rangeStart, $lt: rangeEnd },
        status: { $in: ["scheduled", "rescheduled", "completed"] }
      })
        .sort({ startTime: 1, createdAt: -1 })
        .limit(10)
        .select("title clientName startTime meetingDate priority status")
        .lean(),
      Deal.countDocuments({
        assignedTo: userId,
        status: "open",
        is_deleted: { $ne: true }
      }),
      Deal.countDocuments({
        assignedTo: userId,
        status: "open",
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
        is_deleted: { $ne: true }
      }),
      Deal.aggregate([
        {
          $match: {
            assignedTo: userId,
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
      Deal.find({
        assignedTo: userId,
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
        assigned_to: userId,
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
            assignedTo: userId,
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
      Event.countDocuments({
        is_deleted: false,
        registeredBy: userId,
        startDate: { $gte: rangeStart, $lt: rangeEnd }
      }),
      Event.countDocuments({
        is_deleted: false,
        attendedBy: userId,
        startDate: { $gte: rangeStart, $lt: rangeEnd }
      }),
      Event.countDocuments({
        is_deleted: false,
        status: "completed",
        registeredBy: userId,
        attendedBy: { $ne: userId },
        startDate: { $gte: rangeStart, $lt: rangeEnd }
      }),
      Meeting.countDocuments({
        assignedTo: userId,
        is_deleted: { $ne: true },
        meetingDate: { $gte: now },
        status: { $in: ["scheduled", "rescheduled"] }
      }),
      Event.countDocuments({
        is_deleted: false,
        registeredBy: userId,
        status: "upcoming",
        startDate: { $gte: now }
      }),
      Deal.aggregate([
        {
          $match: {
            assignedTo: userId,
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
    const pipelineValue = dealStatusMap.get("open")?.value || 0;
    const monthlyTarget = Number(targetDoc?.revenue_target || 0);
    const monthlyAchieved = Number(monthlyAchievedAgg?.[0]?.total || 0);
    const monthlyAchievedPct = monthlyTarget
      ? clampPercent((monthlyAchieved / monthlyTarget) * 100)
      : 0;

    const mappedFollowups = followupLeads.map((lead) => ({
      id: lead._id,
      kind: "followup",
      company: lead.company_name || "Unknown company",
      message: lead.next_action || "Follow up with this lead",
      dueAt: lead.last_contact_date || null,
      priority: getLeadPriority(lead)
    }));
    const mappedMeetings = meetings.map((meeting) => ({
      id: meeting._id,
      kind: "meeting",
      company: meeting.clientName || "Scheduled meeting",
      message: meeting.title || "Meeting",
      dueAt: meeting.startTime || meeting.meetingDate || null,
      priority: String(meeting.priority || "medium").replace(/^./, (char) => char.toUpperCase()),
      status: meeting.status || "scheduled"
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
    const totalMeetings = scheduledMeetings + completedMeetings + cancelledMeetings;
    const totalEvents = registeredEvents + attendedEvents + missedEvents;

    return res.json({
      range: selectedRange.range,
      summary: {
        followupsToday: mappedFollowups.length,
        meetingsToday: mappedMeetings.length,
        highPriorityFollowups: mappedFollowups.filter((item) => item.priority === "High").length,
        activeDeals,
        dealsAddedThisWeek: newDealsThisWeek,
        monthlyTarget,
        monthlyAchieved,
        monthlyAchievedPct,
        winRate,
        wonDeals,
        closedDeals,
        pipelineValue
      },
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
          { name: "Scheduled", value: scheduledMeetings },
          { name: "Conducted", value: completedMeetings },
          { name: "Cancelled", value: cancelledMeetings }
        ],
        events: [
          { name: "Registered", value: registeredEvents },
          { name: "Attended", value: attendedEvents },
          { name: "Missed", value: missedEvents }
        ],
        footerStats: {
          meetingRate: totalMeetings ? clampPercent((completedMeetings / totalMeetings) * 100) : 0,
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
