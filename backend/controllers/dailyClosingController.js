const DailyClosingAttendance = require("../models/daily_closing_attendance");
const DailyClosingHighlights = require("../models/daily_closing_highlights");
const User = require("../models/users");
const Team = require("../models/teams");
const Organization = require("../models/organization");
const emailService = require("../services/emailService");

function parseDateOnlyInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDateRangeInput(fromRaw, toRaw) {
  const from = parseDateOnlyInput(fromRaw);
  const to = parseDateOnlyInput(toRaw);
  if (!from && !to) return null;

  const start = from || new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const endBase = to || new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));
  const end = new Date(endBase.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function normalizeRoleName(role = "") {
  return String(role || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDisplayDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildRowsHtml(rows = [], kindLabel = "Record") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<tr><td colspan="5" style="padding:8px;border:1px solid #e5e7eb;color:#6b7280;">No ${escapeHtml(kindLabel)} found.</td></tr>`;
  }

  return rows
    .map((row, index) => {
      const clientName = row?.clientName || "-";
      const details = row?.notes || row?.title || "-";
      const action = row?.status || row?.action || row?.dueTime || "-";
      const type = row?.type || kindLabel;
      return `
        <tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${index + 1}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(type)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(clientName)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(details)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(action)}</td>
        </tr>
      `;
    })
    .join("");
}

function buildReportMailHtml({
  companyName,
  senderName,
  senderRole,
  selectedDate,
  keyHighlights,
  meetings = [],
  followups = [],
}) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f6fb;padding:20px;">
      <div style="max-width:900px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;">
        <h2 style="margin:0;color:#0f172a;">${escapeHtml(companyName || "Company")} - Daily Closing Report</h2>
        <p style="margin:8px 0 0;color:#334155;">
          Date: <strong>${escapeHtml(formatDisplayDate(selectedDate))}</strong>
        </p>
        <p style="margin:4px 0 16px;color:#334155;">
          Submitted By: <strong>${escapeHtml(senderName || "-")}</strong> (${escapeHtml(senderRole || "-")})
        </p>

        <h3 style="margin:14px 0 8px;color:#0f172a;">Event Details (${meetings.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#eef2ff;">
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Sr. No.</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Type</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Client Name</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Details</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Action</th>
            </tr>
          </thead>
          <tbody>${buildRowsHtml(meetings, "Meeting")}</tbody>
        </table>

        <h3 style="margin:16px 0 8px;color:#0f172a;">Follow-up Details (${followups.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#eef2ff;">
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Sr. No.</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Type</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Client Name</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Details</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Action</th>
            </tr>
          </thead>
          <tbody>${buildRowsHtml(followups, "Follow-up")}</tbody>
        </table>

        <div style="margin-top:16px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;">
          <strong>Key Highlights:</strong>
          <div style="margin-top:6px;color:#334155;">${escapeHtml(keyHighlights || "-")}</div>
        </div>
      </div>
    </div>
  `;
}

exports.submit = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const selectedDateRaw = req.body?.selectedDate;
    const keyHighlights = String(req.body?.keyHighlights || "").trim();

    if (!selectedDateRaw) {
      return res.status(400).json({ message: "selectedDate is required" });
    }

    if (!keyHighlights) {
      return res.status(400).json({ message: "keyHighlights is required" });
    }

    const selectedDate = parseDateOnlyInput(selectedDateRaw);
    if (!selectedDate) {
      return res.status(400).json({ message: "selectedDate must be in YYYY-MM-DD format" });
    }

    const now = new Date();

    let attendanceDoc = await DailyClosingAttendance.findOne({
      user_id: userId,
      attendance_of_date: selectedDate,
    });

    if (attendanceDoc) {
      attendanceDoc.daily_closing_date = now;
      await attendanceDoc.save();
    } else {
      attendanceDoc = await DailyClosingAttendance.create({
        attendance_of_date: selectedDate,
        daily_closing_date: now,
        user_id: userId,
      });
    }

    let highlightsDoc = await DailyClosingHighlights.findOne({
      user_id: userId,
      daily_closing_date: selectedDate,
    });

    if (highlightsDoc) {
      highlightsDoc.key_highlights = keyHighlights;
      await highlightsDoc.save();
    } else {
      highlightsDoc = await DailyClosingHighlights.create({
        daily_closing_date: selectedDate,
        key_highlights: keyHighlights,
        user_id: userId,
      });
    }

    return res.status(200).json({
      message: "Daily closing saved",
      data: {
        attendance: attendanceDoc,
        highlights: highlightsDoc,
      },
    });
  } catch (err) {
    console.error("dailyClosing.submit error:", err);
    return res.status(500).json({ message: "Failed to save daily closing" });
  }
};

exports.mailReport = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const selectedDate = String(req.body?.selectedDate || "").trim();
    const keyHighlights = String(req.body?.keyHighlights || "").trim();
    const meetings = Array.isArray(req.body?.meetings) ? req.body.meetings : [];
    const followups = Array.isArray(req.body?.followups) ? req.body.followups : [];

    if (!selectedDate) {
      return res.status(400).json({ message: "selectedDate is required" });
    }

    const me = await User.findById(userId).populate("role", "name").select("name email role").lean();
    if (!me) {
      return res.status(404).json({ message: "User not found" });
    }

    const senderRole = normalizeRoleName(me?.role?.name || req.user?.role);
    const senderName = me?.name || "User";

    const users = await User.find({ is_deleted: { $ne: true } })
      .populate("role", "name")
      .select("name email role")
      .lean();

    const admins = users.filter((u) => normalizeRoleName(u?.role?.name) === "admin");
    const managers = users.filter((u) => normalizeRoleName(u?.role?.name) === "manager");

    let recipientEmails = [];

    if (senderRole === "manager") {
      recipientEmails = admins.map((u) => String(u.email || "").trim()).filter(Boolean);
    } else {
      // User / Sales: send to own team manager(s) + admin(s)
      const myTeams = await Team.find({ "members.userId": userId }).select("teamLeads.userId").lean();
      const managerIds = new Set(
        myTeams.flatMap((t) => (t.teamLeads || []).map((lead) => String(lead.userId || "")).filter(Boolean))
      );
      const teamManagers = managers.filter((m) => managerIds.has(String(m._id)));

      recipientEmails = [
        ...teamManagers.map((u) => String(u.email || "").trim()),
        ...admins.map((u) => String(u.email || "").trim()),
      ].filter(Boolean);
    }

    const senderEmail = String(me?.email || "").trim().toLowerCase();
    recipientEmails = [...new Set(recipientEmails.map((e) => e.toLowerCase()))].filter((e) => e !== senderEmail);

    if (recipientEmails.length === 0) {
      return res.status(400).json({ message: "No recipient email found for this role mapping" });
    }

    const org = await Organization.findOne({ is_deleted: false }).sort({ createdAt: -1 }).select("name").lean();
    const companyName = org?.name || "Company";

    const subject = `Daily Closing Report - ${formatDisplayDate(selectedDate)} - ${senderName}`;
    const html = buildReportMailHtml({
      companyName,
      senderName,
      senderRole: me?.role?.name || senderRole,
      selectedDate,
      keyHighlights,
      meetings,
      followups,
    });

    await emailService.sendEmail({
      to: recipientEmails.join(","),
      subject,
      html,
      text: `Daily Closing Report\nDate: ${selectedDate}\nSubmitted By: ${senderName}\nKey Highlights: ${keyHighlights || "-"}`,
      fromName: companyName,
    });

    return res.status(200).json({
      message: "Report emailed successfully",
      recipients: recipientEmails,
    });
  } catch (err) {
    console.error("dailyClosing.mailReport error:", err);
    return res.status(500).json({ message: "Failed to mail report" });
  }
};

exports.listForCalendar = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const range = parseDateRangeInput(req.query?.from, req.query?.to);
    const filter = { user_id: userId };
    if (range) {
      filter.daily_closing_date = { $gte: range.start, $lt: range.end };
    }

    const rows = await DailyClosingHighlights.find(filter)
      .sort({ daily_closing_date: 1 })
      .select("daily_closing_date key_highlights updated_at created_at")
      .lean();

    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const hasTodayEntry = rows.some((row) => {
      const d = new Date(row?.daily_closing_date);
      return d >= todayStart && d < tomorrowStart;
    });

    return res.status(200).json({
      rows,
      hasTodayEntry,
    });
  } catch (err) {
    console.error("dailyClosing.listForCalendar error:", err);
    return res.status(500).json({ message: "Failed to fetch daily closing calendar entries" });
  }
};
