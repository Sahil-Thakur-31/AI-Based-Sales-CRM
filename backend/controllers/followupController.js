const Followup = require("../models/followUp");
const User = require("../models/users");

const normalizeRole = (roleValue = "") =>
  String(roleValue).trim().toLowerCase().replace(/\s+/g, "");

const getRoleScope = (req) => {
  const role = normalizeRole(req.user?.role);

  if (role.includes("admin")) {
    return "admin";
  }

  if (role.includes("manager")) {
    return "manager";
  }

  return "salesperson";
};

const getDateBounds = () => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  return { now, startOfToday, endOfToday, endOfWeek };
};

const getScopeFilter = (req) => {
  const scope = getRoleScope(req);
  if (scope === "salesperson") {
    return { assignedTo: req.user._id };
  }
  return {};
};

const buildBucketFilter = (bucket, now, startOfToday, endOfToday, endOfWeek) => {
  switch (bucket) {
    case "today":
      return {
        dueDateTime: { $gte: startOfToday, $lt: endOfToday },
        status: { $nin: ["completed", "cancelled"] }
      };
    case "week":
      return {
        dueDateTime: { $gte: startOfToday, $lt: endOfWeek },
        status: { $nin: ["completed", "cancelled"] }
      };
    case "overdue":
      return {
        dueDateTime: { $lt: now },
        status: { $nin: ["completed", "cancelled"] }
      };
    case "completed":
      return {
        status: "completed"
      };
    default:
      return {
        status: { $nin: ["completed", "cancelled"] }
      };
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const bucket = String(req.query.bucket || "today").toLowerCase();
    const search = String(req.query.search || "").trim();

    const scopeFilter = getScopeFilter(req);
    const { now, startOfToday, endOfToday, endOfWeek } = getDateBounds();

    const baseFilter = {
      is_deleted: false,
      ...scopeFilter
    };

    const [
      todayCount,
      weekCount,
      overdueCount,
      completedCount,
      pendingCount,
      highPriorityCount,
      totalCount,
      completedTodayCount
    ] = await Promise.all([
      Followup.countDocuments({
        ...baseFilter,
        dueDateTime: { $gte: startOfToday, $lt: endOfToday }
      }),
      Followup.countDocuments({
        ...baseFilter,
        dueDateTime: { $gte: startOfToday, $lt: endOfWeek }
      }),
      Followup.countDocuments({
        ...baseFilter,
        dueDateTime: { $lt: now },
        status: { $nin: ["completed", "cancelled"] }
      }),
      Followup.countDocuments({
        ...baseFilter,
        status: "completed"
      }),
      Followup.countDocuments({
        ...baseFilter,
        status: { $in: ["pending", "overdue"] }
      }),
      Followup.countDocuments({
        ...baseFilter,
        priority: { $in: ["high", "urgent"] },
        status: { $nin: ["completed", "cancelled"] }
      }),
      Followup.countDocuments(baseFilter),
      Followup.countDocuments({
        ...baseFilter,
        status: "completed",
        completedAt: { $gte: startOfToday, $lt: endOfToday }
      })
    ]);

    const listFilter = {
      ...baseFilter,
      ...buildBucketFilter(bucket, now, startOfToday, endOfToday, endOfWeek)
    };

    if (search) {
      listFilter.title = { $regex: search, $options: "i" };
    }

    const followups = await Followup.find(listFilter)
      .populate({
        path: "assignedTo",
        select: "name email",
        model: "users"
      })
      .sort({ dueDateTime: 1, aiScore: -1, createdAt: -1 })
      .limit(50)
      .lean();

    const activeFollowups = followups.map((item) => {
      const dueDate = item.dueDateTime ? new Date(item.dueDateTime) : null;
      const isOverdue =
        !!dueDate &&
        dueDate < now &&
        !["completed", "cancelled"].includes(item.status);

      return {
        _id: item._id,
        title: item.title,
        actionType: item.actionType || "call",
        assignedToName: item.assignedTo?.name || "Unassigned",
        dueDateTime: item.dueDateTime,
        status: item.status,
        priority: item.priority,
        aiScore: item.aiScore ?? null,
        aiSuggested: item.aiSuggested || "",
        isOverdue
      };
    });

    const aiScored = activeFollowups.filter((f) => typeof f.aiScore === "number");
    const avgAiScore =
      aiScored.length > 0
        ? Math.round(
            aiScored.reduce((sum, row) => sum + row.aiScore, 0) / aiScored.length
          )
        : 0;

    const typeCounts = activeFollowups.reduce(
      (acc, row) => {
        const key = String(row.actionType || "").toLowerCase();
        if (key.includes("email")) {
          acc.emails += 1;
        } else if (key.includes("meeting") || key.includes("demo")) {
          acc.meetings += 1;
        } else {
          acc.calls += 1;
        }
        return acc;
      },
      { calls: 0, emails: 0, meetings: 0 }
    );

    const totalTypes = Math.max(
      typeCounts.calls + typeCounts.emails + typeCounts.meetings,
      1
    );

    const adherenceDenominator = Math.max(completedTodayCount + pendingCount, 1);
    const adherenceRate = Math.round((completedTodayCount / adherenceDenominator) * 100);

    const suggestions = [...activeFollowups]
      .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0))
      .slice(0, 4)
      .map((row) => ({
        followupId: row._id,
        title: row.title,
        suggestion:
          row.aiSuggested ||
          "Confirm next step and share a clear outcome timeline with the client."
      }));

    const cards = [
      { key: "today", title: "Today", subtitle: "Due today", count: todayCount, tone: "purple" },
      { key: "week", title: "This Week", subtitle: "Upcoming", count: weekCount, tone: "green" },
      { key: "overdue", title: "Overdue", subtitle: "Needs action", count: overdueCount, tone: "blue" },
      { key: "completed", title: "Completed", subtitle: "Done", count: completedCount, tone: "orange" },
      { key: "pending", title: "Pending", subtitle: "Open follow-ups", count: pendingCount, tone: "gold" },
      { key: "high_priority", title: "High Priority", subtitle: "High or urgent", count: highPriorityCount, tone: "red" },
      { key: "total", title: "Total", subtitle: "All follow-ups", count: totalCount, tone: "teal" }
    ];

    return res.json({
      cards,
      activeFollowups,
      stats: {
        adherenceRate,
        completedToday: completedTodayCount,
        pending: pendingCount,
        avgAiScore,
        byType: {
          calls: Math.round((typeCounts.calls / totalTypes) * 100),
          emails: Math.round((typeCounts.emails / totalTypes) * 100),
          meetings: Math.round((typeCounts.meetings / totalTypes) * 100)
        }
      },
      suggestions
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load follow-up dashboard." });
  }
};

exports.createFollowup = async (req, res) => {
  try {
    const { title, actionType, dueDateTime, priority, aiScore, aiSuggested, assignedTo } = req.body;

    if (!title || !dueDateTime) {
      return res.status(400).json({ message: "title and dueDateTime are required." });
    }

    const scope = getRoleScope(req);
    const assignee =
      scope === "salesperson" ? req.user._id : assignedTo || req.user._id;

    const followup = await Followup.create({
      title: String(title).trim(),
      actionType: actionType || "call",
      dueDateTime: new Date(dueDateTime),
      priority: priority || "medium",
      aiScore: aiScore === "" || aiScore === null || aiScore === undefined ? undefined : aiScore,
      aiSuggested: aiSuggested || "",
      assignedTo: assignee,
      status: "pending"
    });

    return res.status(201).json(followup);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to create follow-up." });
  }
};

exports.completeFollowup = async (req, res) => {
  try {
    const scopeFilter = getScopeFilter(req);
    const now = new Date();

    const followup = await Followup.findOneAndUpdate(
      {
        _id: req.params.id,
        is_deleted: false,
        ...scopeFilter
      },
      {
        $set: {
          status: "completed",
          completedAt: now
        }
      },
      { new: true }
    );

    if (!followup) {
      return res.status(404).json({ message: "Follow-up not found." });
    }

    return res.json(followup);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to update follow-up." });
  }
};

exports.getAssignableUsers = async (req, res) => {
  try {
    const scope = getRoleScope(req);

    if (scope === "salesperson") {
      const self = await User.findById(req.user._id).select("name email").lean();
      return res.json(self ? [self] : []);
    }

    const users = await User.find({ is_deleted: false, is_active: true })
      .select("name email")
      .sort({ name: 1 })
      .lean();

    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch users." });
  }
};
