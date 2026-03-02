const Meeting = require("../models/meetings");
const Followup = require("../models/followUp");
const Lead = require("../models/leads");
const Expense = require("../models/expenses");
const Event = require("../models/events");
const User = require("../models/users");

const TEMPLATE_KEYS = {
  MEETING_SCHEDULED: "meeting_scheduled",
  FOLLOWUP_SCHEDULED: "followup_scheduled",
  MEETING_COMPLETED: "meeting_completed",
  LEAD_ASSIGNED: "lead_assigned",
  PROFILE_COMPLETION: "profile_completion",
  EXPENSE_APPROVED: "expense_approved",
  EXPENSE_REJECTED: "expense_rejected",
  EVENT_ATTENDEE_INVITATION: "event_attendee_invitation",
  GENERIC: "generic",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value, locale = "en-IN") {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value, locale = "en-IN") {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function buildLayout({ heading, intro, rows = [], ctaUrl = "", ctaLabel = "Open CRM" }) {
  const rowsHtml = rows
    .filter((row) => row && row.label && row.value !== undefined && row.value !== null && row.value !== "")
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(row.value)}</td>
        </tr>
      `
    )
    .join("");

  const ctaHtml = ctaUrl
    ? `
      <div style="margin-top:20px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>
    `
    : "";

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f3f4f6;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;">
        <h2 style="margin:0 0 10px;color:#111827;">${escapeHtml(heading)}</h2>
        <p style="margin:0 0 14px;color:#374151;line-height:1.5;">${escapeHtml(intro)}</p>
        <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
        ${ctaHtml}
      </div>
    </div>
  `;
}

function inferTemplateKey(notification = {}) {
  const explicit = String(notification.templateKey || notification.category || "").trim();
  if (explicit && Object.values(TEMPLATE_KEYS).includes(explicit)) return explicit;

  const blob = `${notification.title || ""} ${notification.message || ""} ${notification.relatedType || ""}`.toLowerCase();

  if (blob.includes("lead") && blob.includes("assigned")) return TEMPLATE_KEYS.LEAD_ASSIGNED;
  if (blob.includes("meeting") && blob.includes("completed")) return TEMPLATE_KEYS.MEETING_COMPLETED;
  if (blob.includes("meeting") && (blob.includes("scheduled") || blob.includes("schedule") || blob.includes("rescheduled"))) {
    return TEMPLATE_KEYS.MEETING_SCHEDULED;
  }
  if (blob.includes("follow") && (blob.includes("scheduled") || blob.includes("schedule") || blob.includes("reminder"))) {
    return TEMPLATE_KEYS.FOLLOWUP_SCHEDULED;
  }
  if (blob.includes("profile") && (blob.includes("complete") || blob.includes("completion"))) {
    return TEMPLATE_KEYS.PROFILE_COMPLETION;
  }
  if (blob.includes("expense") && blob.includes("approved")) return TEMPLATE_KEYS.EXPENSE_APPROVED;
  if (blob.includes("expense") && blob.includes("rejected")) return TEMPLATE_KEYS.EXPENSE_REJECTED;
  if (blob.includes("event") && (blob.includes("attendee") || blob.includes("invitation") || blob.includes("registered"))) {
    return TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION;
  }

  return TEMPLATE_KEYS.GENERIC;
}

async function resolveRelatedData(notification = {}) {
  const relatedId = notification.relatedId;
  if (!relatedId) return null;

  const relatedType = String(notification.relatedType || "").toLowerCase();

  if (relatedType === "meeting" || relatedType === "meetings") {
    return Meeting.findById(relatedId).lean();
  }
  if (relatedType === "followup" || relatedType === "follow_up") {
    return Followup.findById(relatedId).lean();
  }
  if (relatedType === "lead" || relatedType === "leads") {
    return Lead.findById(relatedId).lean();
  }
  if (relatedType === "expense" || relatedType === "expenses") {
    return Expense.findById(relatedId).lean();
  }
  if (relatedType === "event" || relatedType === "events") {
    return Event.findById(relatedId).lean();
  }
  if (relatedType === "user" || relatedType === "users" || relatedType === "profile") {
    return User.findById(relatedId).lean();
  }

  // Fallback: try likely collections
  const [meeting, followup, lead, expense, event, user] = await Promise.all([
    Meeting.findById(relatedId).lean(),
    Followup.findById(relatedId).lean(),
    Lead.findById(relatedId).lean(),
    Expense.findById(relatedId).lean(),
    Event.findById(relatedId).lean(),
    User.findById(relatedId).lean(),
  ]);

  return meeting || followup || lead || expense || event || user || null;
}

function buildTemplateByKey({
  templateKey,
  notification = {},
  relatedData = null,
  recipientName = "",
  appBaseUrl = "",
}) {
  const safeRecipient = recipientName || "there";
  const genericSubject = notification.title || "CRM Notification";
  const genericIntro = notification.message || "You have a new CRM notification.";
  const relatedId = notification.relatedId ? String(notification.relatedId) : "";
  const relatedType = String(notification.relatedType || "").toLowerCase();

  const ctaUrl =
    appBaseUrl && relatedId
      ? (() => {
          if (relatedType === "lead" || relatedType === "leads") return `${appBaseUrl}/leads/${relatedId}`;
          if (relatedType === "meeting" || relatedType === "meetings") return `${appBaseUrl}/followups`;
          if (relatedType === "followup" || relatedType === "follow_up") return `${appBaseUrl}/followups`;
          if (relatedType === "expense" || relatedType === "expenses") return `${appBaseUrl}/expenses`;
          if (relatedType === "event" || relatedType === "events") return `${appBaseUrl}/events`;
          if (relatedType === "user" || relatedType === "profile") return `${appBaseUrl}/profile`;
          return appBaseUrl;
        })()
      : appBaseUrl;

  switch (templateKey) {
    case TEMPLATE_KEYS.MEETING_SCHEDULED: {
      const subject = `Meeting Scheduled: ${relatedData?.title || notification.title || "New Meeting"}`;
      const intro = `Hi ${safeRecipient}, a meeting has been scheduled for you.`;
      const rows = [
        { label: "Title", value: relatedData?.title || "" },
        { label: "Client", value: relatedData?.clientName || "" },
        { label: "Date", value: formatDate(relatedData?.meetingDate || relatedData?.startTime) },
        { label: "Start Time", value: formatDateTime(relatedData?.startTime) },
        { label: "Type", value: relatedData?.meetingType || "" },
        { label: "Priority", value: relatedData?.priority || "" },
        { label: "Location", value: relatedData?.Address || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "New Meeting Scheduled", intro, rows, ctaUrl, ctaLabel: "View Meeting" }),
        text: `${intro}\nTitle: ${rows[0].value}\nDate: ${rows[2].value}\nTime: ${rows[3].value}\nLocation: ${rows[6].value}`,
      };
    }

    case TEMPLATE_KEYS.FOLLOWUP_SCHEDULED: {
      const subject = `Follow-up Scheduled: ${relatedData?.title || "Action Required"}`;
      const intro = `Hi ${safeRecipient}, a follow-up has been scheduled for you.`;
      const rows = [
        { label: "Title", value: relatedData?.title || "" },
        { label: "Client", value: relatedData?.clientName || "" },
        { label: "Due", value: formatDateTime(relatedData?.dueDateTime) },
        { label: "Priority", value: relatedData?.priority || "" },
        { label: "Stage", value: relatedData?.stage || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Follow-up Scheduled", intro, rows, ctaUrl, ctaLabel: "View Follow-up" }),
        text: `${intro}\nTitle: ${rows[0].value}\nDue: ${rows[2].value}\nPriority: ${rows[3].value}`,
      };
    }

    case TEMPLATE_KEYS.MEETING_COMPLETED: {
      const subject = `Meeting Completed: ${relatedData?.title || notification.title || "Meeting Update"}`;
      const intro = `Hi ${safeRecipient}, a meeting has been marked as completed.`;
      const rows = [
        { label: "Title", value: relatedData?.title || "" },
        { label: "Client", value: relatedData?.clientName || "" },
        { label: "Status", value: relatedData?.status || "completed" },
        { label: "Date", value: formatDate(relatedData?.meetingDate || relatedData?.updatedAt) },
        { label: "Minutes", value: relatedData?.minutes_of_meeting || "" },
        { label: "Next Action", value: relatedData?.nextAction || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Meeting Completed", intro, rows, ctaUrl, ctaLabel: "View Details" }),
        text: `${intro}\nTitle: ${rows[0].value}\nStatus: ${rows[2].value}\nNext Action: ${rows[5].value}`,
      };
    }

    case TEMPLATE_KEYS.LEAD_ASSIGNED: {
      const subject = `Lead Assigned: ${relatedData?.company_name || "New Lead"}`;
      const intro = `Hi ${safeRecipient}, a lead has been assigned to you.`;
      const rows = [
        { label: "Company", value: relatedData?.company_name || "" },
        { label: "Industry", value: relatedData?.industry || "" },
        { label: "Value Estimate", value: formatCurrency(relatedData?.deal_value_estimate) },
        { label: "Temperature", value: relatedData?.lead_temperature || "" },
        { label: "Status", value: relatedData?.status || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Lead Assigned To You", intro, rows, ctaUrl, ctaLabel: "Open Lead" }),
        text: `${intro}\nCompany: ${rows[0].value}\nIndustry: ${rows[1].value}\nValue: ${rows[2].value}`,
      };
    }

    case TEMPLATE_KEYS.PROFILE_COMPLETION: {
      const subject = "Profile Completion Reminder";
      const intro = `Hi ${safeRecipient}, please complete your profile to enable better workflow assignments and alerts.`;
      const rows = [
        { label: "Name", value: relatedData?.name || "" },
        { label: "Email", value: relatedData?.email || "" },
        { label: "Phone", value: relatedData?.phone || "" },
        { label: "Address", value: relatedData?.address || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Complete Your Profile", intro, rows, ctaUrl, ctaLabel: "Update Profile" }),
        text: `${intro}\nPlease update your details in CRM profile settings.`,
      };
    }

    case TEMPLATE_KEYS.EXPENSE_APPROVED: {
      const subject = `Expense Approved: #${relatedData?.expenseNo || ""}`;
      const intro = `Hi ${safeRecipient}, your expense request has been approved.`;
      const rows = [
        { label: "Expense No", value: relatedData?.expenseNo || "" },
        { label: "Amount", value: formatCurrency(relatedData?.totalAmount || relatedData?.amount) },
        { label: "Expense Date", value: formatDate(relatedData?.expenseDate) },
        { label: "Status", value: relatedData?.approval?.status || "approved" },
        { label: "Remarks", value: relatedData?.approval?.remarks || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Expense Approved", intro, rows, ctaUrl, ctaLabel: "View Expense" }),
        text: `${intro}\nExpense No: ${rows[0].value}\nAmount: ${rows[1].value}\nStatus: ${rows[3].value}`,
      };
    }

    case TEMPLATE_KEYS.EXPENSE_REJECTED: {
      const subject = `Expense Rejected: #${relatedData?.expenseNo || ""}`;
      const intro = `Hi ${safeRecipient}, your expense request has been rejected.`;
      const rows = [
        { label: "Expense No", value: relatedData?.expenseNo || "" },
        { label: "Amount", value: formatCurrency(relatedData?.totalAmount || relatedData?.amount) },
        { label: "Expense Date", value: formatDate(relatedData?.expenseDate) },
        { label: "Status", value: relatedData?.approval?.status || "rejected" },
        { label: "Remarks", value: relatedData?.approval?.remarks || "" },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Expense Rejected", intro, rows, ctaUrl, ctaLabel: "View Expense" }),
        text: `${intro}\nExpense No: ${rows[0].value}\nAmount: ${rows[1].value}\nRemarks: ${rows[4].value}`,
      };
    }

    case TEMPLATE_KEYS.EVENT_ATTENDEE_INVITATION: {
      const subject = `Event Invitation: ${relatedData?.name || "New Event"}`;
      const intro = `Hi ${safeRecipient}, you are invited as a registered attendee for an event.`;
      const rows = [
        { label: "Event", value: relatedData?.name || "" },
        { label: "Venue", value: relatedData?.venue || "" },
        { label: "Address", value: relatedData?.address || "" },
        { label: "Start Date", value: formatDate(relatedData?.startDate) },
        { label: "End Date", value: formatDate(relatedData?.endDate) },
        { label: "Registration Fee", value: formatCurrency(relatedData?.registrationFee) },
      ];
      return {
        subject,
        html: buildLayout({ heading: "Event Registration Invitation", intro, rows, ctaUrl, ctaLabel: "View Event" }),
        text: `${intro}\nEvent: ${rows[0].value}\nVenue: ${rows[1].value}\nStart: ${rows[3].value}`,
      };
    }

    case TEMPLATE_KEYS.GENERIC:
    default: {
      return {
        subject: genericSubject,
        html: buildLayout({
          heading: genericSubject,
          intro: genericIntro,
          rows: [
            { label: "Type", value: notification.type || "" },
            { label: "Related Type", value: notification.relatedType || "" },
          ],
          ctaUrl,
          ctaLabel: "Open Notification",
        }),
        text: `${genericSubject}\n${genericIntro}`,
      };
    }
  }
}

async function buildNotificationEmail({
  notification,
  recipientName = "",
  appBaseUrl = "",
  relatedData = null,
}) {
  const templateKey = inferTemplateKey(notification);
  const entityData = relatedData || (await resolveRelatedData(notification));

  const mail = buildTemplateByKey({
    templateKey,
    notification,
    relatedData: entityData,
    recipientName,
    appBaseUrl,
  });

  return {
    templateKey,
    relatedData: entityData,
    ...mail,
  };
}

module.exports = {
  TEMPLATE_KEYS,
  inferTemplateKey,
  resolveRelatedData,
  buildNotificationEmail,
};