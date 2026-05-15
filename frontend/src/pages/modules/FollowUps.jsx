import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
import Pagination from "../../components/Pagination";
import { minLength, required } from "../../utils/formValidation";
import "./styles/Followups.css";

const STAGES = [
  { key: "P1", title: "P1 - Quote Sent", sub: "Awaiting response" },
  { key: "P2", title: "P2 - Meeting Scheduled", sub: "Upcoming meetings" },
  { key: "P3", title: "P3 - In Conversation", sub: "Active discussions" },
  { key: "P4", title: "P4 - No Service", sub: "Service unavailable" },
  { key: "P5", title: "P5 - RNR", sub: "Right Now Right" },
  { key: "P6", title: "P6 - No Response", sub: "Follow-up needed" },
  { key: "P7", title: "P7 - Won", sub: "Deal closed" },
];

const LEAD_STAGES = STAGES.map((stage) =>
  stage.key === "P3"
    ? { ...stage, title: "P3 - Fresh Leads", sub: "When we create new leads" }
    : stage.key === "P7"
      ? { ...stage, title: "P7 - Lead Convert to Deal", sub: "Converted leads" }
      : stage
);

const DEAL_STAGE_KEYS = new Set(["P1", "P2", "P3", "P6", "P7"]);
const DEAL_STAGES = STAGES.map((stage) => ({
  ...(stage.key === "P3"
    ? { ...stage, title: "P3 - Fresh Deals", sub: "New deals and converted leads" }
    : stage),
  hidden: !DEAL_STAGE_KEYS.has(stage.key),
}));

const EMPTY_FOLLOWUP_FORM = {
  client: "",
  title: "",
  dueDateTime: "",
  stage: "P1",
  priority: "medium",
};

const EMPTY_MEETING_FORM = {
  client: "",
  title: "",
  dueDateTime: "",
  meetingLocation: "",
  meetingExactLocation: "",
  priority: "medium",
  minutesOfMeeting: "",
  status: "pending",
};

const EMPTY_DONE_MODAL = {
  id: "",
  kind: "meeting",
  durationMinutes: "",
  minutesOfMeeting: "",
  nextFollowup: "no",
  nextFollowupDate: "",
  nextReminder: "yes",
  nextStage: "P1",
  reasonForLost: "",
  sourceData: null,
};

const EMPTY_CANCEL_MODAL = {
  open: false,
  id: "",
  kind: "followup",
  reason: "",
};

const PAGE_SIZE = 5;

function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}

function formatDate(rawDate) {
  if (!rawDate) return "TBD";
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(rawDate) {
  if (!rawDate) return "--:--";
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toInputDateTime(rawDate) {
  if (!rawDate) return "";
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function getLocalDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function combineDateWithBaseTime(dateOnly, baseDateTime) {
  if (!dateOnly) return null;
  const [y, m, d] = String(dateOnly).split("-").map(Number);
  if (!y || !m || !d) return null;

  const base = new Date(baseDateTime || Date.now());
  const hours = Number.isNaN(base.getTime()) ? 9 : base.getHours();
  const minutes = Number.isNaN(base.getTime()) ? 0 : base.getMinutes();
  const composed = new Date(y, m - 1, d, hours, minutes, 0, 0);
  if (Number.isNaN(composed.getTime())) return null;
  return composed.toISOString();
}

function isOnLocalDate(rawDate, targetDate) {
  if (!rawDate) return false;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}` === targetDate;
}

function getRelevantDateForStatus(item = {}, statusFilter = "all") {
  const completed = isCompletedStatus(item?.status);
  if (statusFilter === "completed" || completed) {
    return item?.completedAt || item?.dueDateTime;
  }
  return item?.dueDateTime;
}

function mapDocToMeeting(doc) {
  const dueDateTime = doc.dueDateTime || doc.startTime || doc.meetingDate;
  const followupId = doc.sourceFollowupId || doc.Id || doc.followupId || doc._id;
  const resolvedAddress =
    doc.meetingLocation ||
    doc.address ||
    doc.Address ||
    doc.currentLocation ||
    "";
  const resolvedLocation =
    doc.meetingExactLocation ||
    doc.exactLocation ||
    doc.currentExactLocation ||
    [doc.latitude, doc.longitude].filter(Boolean).join(", ");
  return {
    id: String(followupId),
    leadId: doc.leadId || "",
    dealId: doc.dealId || "",
    clientId: doc.clientId || "",
    clientName: doc.clientName || "N/A",
    title: doc.title || "",
    eventType: doc.actionType || doc.meetingType || "Meeting",
    time: formatTime(dueDateTime),
    status: doc.status === "scheduled" ? "pending" : (doc.status || "pending"),
    dueDateTime,
    due: formatDate(dueDateTime),
    priority: doc.priority || "medium",
    notes: doc.notes || "",
    durationMinutes: doc.durationMinutes || "",
    agenda: doc.agenda || doc.agenda_of_meating || "",
    aiPriority: doc.aiPriority || "",
    stage: doc.stage || "",
    completedAt: doc.completedAt || null,
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
    address: resolvedAddress,
    exactLocation: resolvedLocation,
  };
}

function mapDocToFollowup(doc) {
  return {
    id: doc._id,
    leadId: doc.leadId || "",
    dealId: doc.dealId || "",
    clientId: doc.clientId || "",
    client: doc.clientName || "N/A",
    title: doc.title || "",
    stage: doc.stage || "P1",
    due: formatDate(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    time: formatTime(doc.dueDateTime),
    priority: doc.priority || "medium",
    status: doc.status || "pending",
    actionType: doc.actionType || "Follow Up Phone Call",
    notes: doc.notes || "",
    agenda: doc.agenda || "",
    aiPriority: doc.aiPriority || "",
    mob: doc.mob || "",
    reminderEnabled: doc.reminderEnabled === false ? "no" : "yes",
    completedAt: doc.completedAt || null,
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
  };
}

function getAssignedUserId(record = {}) {
  return String(
    record?.assigned_to?._id ||
    record?.assigned_to ||
    record?.assignedTo?._id ||
    record?.assignedTo ||
    record?.assignedToId ||
    ""
  );
}

function mapDealToPipelineItem(doc) {
  return {
    id: String(doc?._id || ""),
    stage: String(doc?.stage || "").trim().toUpperCase(),
    status: String(doc?.status || "").trim().toLowerCase(),
    reasonForLost: String(doc?.reason_for_lost || ""),
    assignedToId: getAssignedUserId(doc),
  };
}

function mapLeadToPipelineItem(doc) {
  return {
    id: String(doc?._id || ""),
    stage: String(doc?.stage || "").trim().toUpperCase(),
    status: String(doc?.status || "").trim().toLowerCase(),
    reasonForLost: String(doc?.reason_for_lost || ""),
    convertedToDeal:
      doc?.converted_to_deal === true || String(doc?.status || "").trim().toLowerCase() === "converted",
    assignedToId: getAssignedUserId(doc),
  };
}

function getAiPriorityClass(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isMeetingLikeAction(actionType = "") {
  return String(actionType).toLowerCase().includes("meeting");
}

function isCompletedStatus(status = "") {
  return String(status).toLowerCase() === "completed";
}

function isCancelledStatus(status = "") {
  return String(status).toLowerCase() === "cancelled";
}

function isPhysicalMeetingEvent(eventType = "") {
  return String(eventType).toLowerCase().includes("physical");
}

function inferRecordBucket(doc) {
  if (doc?.clientId) return "deal";
  if (doc?.dealId) return "deal";
  if (doc?.leadId) return "lead";
  return "deal";
}

function requiresReasonForLost(nextStage = "", sourceData = null) {
  const stage = String(nextStage || "").trim().toUpperCase();
  const bucket = inferRecordBucket(sourceData || {});
  if (bucket === "lead") return stage === "P4" || stage === "P6";
  if (bucket === "deal") return stage === "P6";
  return false;
}

function matchesAssigneeFilter({
  item,
  recordScope,
  selectedEmployeeId,
  selectedTeamId,
  currentUserId,
  teamOptions,
}) {
  const assignedToId = getAssignedUserId(item);

  if (selectedEmployeeId) {
    const targetUserId = selectedEmployeeId === "__mine__" ? currentUserId : selectedEmployeeId;
    return assignedToId === String(targetUserId || "");
  }

  if (recordScope === "mine") {
    return assignedToId === String(currentUserId || "");
  }

  if (selectedTeamId) {
    if (selectedTeamId === "__mine__") {
      return assignedToId === String(currentUserId || "");
    }

    const team = teamOptions.find((t) => String(t.id) === String(selectedTeamId));
    const users = (team?.userIds || []).map((id) => String(id));
    return users.includes(assignedToId);
  }

  return true;
}

function shouldCountDealInStage(deal = {}, stageKey = "") {
  const stage = String(stageKey || "").trim().toUpperCase();
  const dealStage = String(deal?.stage || "").trim().toUpperCase();

  return dealStage === stage;
}

export default function Followups() {
  const [activeStage, setActiveStage] = useState("P1");
  const [recordBucket, setRecordBucket] = useState("lead");
  const [followupMode, setFollowupMode] = useState("list");
  const [followups, setFollowups] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [deals, setDeals] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meetingMode, setMeetingMode] = useState("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [meetingPage, setMeetingPage] = useState(1);
  const [followupPage, setFollowupPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedFollowup, setSelectedFollowup] = useState(null);
  const [editingFollowupId, setEditingFollowupId] = useState(null);
  const [followupForm, setFollowupForm] = useState({ ...EMPTY_FOLLOWUP_FORM, stage: "P1" });
  const [formError, setFormError] = useState("");

  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [editingMeetingId, setEditingMeetingId] = useState(null);
  const [meetingForm, setMeetingForm] = useState({ ...EMPTY_MEETING_FORM });
  const [meetingFormError, setMeetingFormError] = useState("");
  const [doneModal, setDoneModal] = useState({ open: false, ...EMPTY_DONE_MODAL });
  const [doneModalError, setDoneModalError] = useState("");
  const [savingDone, setSavingDone] = useState(false);
  const [cancelModal, setCancelModal] = useState(EMPTY_CANCEL_MODAL);
  const [cancelModalError, setCancelModalError] = useState("");
  const [savingCancel, setSavingCancel] = useState(false);
  const [successModal, setSuccessModal] = useState({ open: false, title: "", subtitle: "" });
  const [scopeLabel, setScopeLabel] = useState("My Records");
  const [currentRole, setCurrentRole] = useState("");
  const [teamOptions, setTeamOptions] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [recordScope, setRecordScope] = useState("mine");
  const useStageFilter = recordBucket !== "existingClient";
  const doneModalStageOptions = useMemo(() => {
    const source = doneModal.sourceData || {};
    const bucket = inferRecordBucket(source);
    return bucket === "lead" ? LEAD_STAGES : DEAL_STAGES;
  }, [doneModal.sourceData]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [meetingRes, followupRes, dealRes, leadRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting" } }),
        API.get("/followups", { params: { kind: "followup" } }),
        API.get("/deals"),
        API.get("/leads", { params: { include_converted: true } }),
      ]);

      const stageById = new Map(
        [...(meetingRes.data || []), ...(followupRes.data || [])]
          .filter((d) => d?._id)
          .map((d) => [String(d._id), d.stage || ""])
      );

      const assignmentById = new Map(
        [...(meetingRes.data || []), ...(followupRes.data || [])]
          .filter((d) => d?._id)
          .map((d) => [
            String(d._id),
            {
              assignedToId: String(d.assignedTo?._id || d.assignedTo || ""),
              assignedToName: d.assignedTo?.name || "",
            },
          ])
      );

      const meetingLikeFollowups = (followupRes.data || []).filter((d) => isMeetingLikeAction(d.actionType));

      const mergedMeetings = [...(meetingRes.data || []), ...meetingLikeFollowups]
        .map(mapDocToMeeting)
        .map((m) => ({ ...m, stage: m.stage || stageById.get(String(m.id)) || "" }))
        .map((m) => ({ ...m, ...(assignmentById.get(String(m.id)) || {}) }))
        .reduce((acc, item) => {
          if (!acc.some((x) => String(x.id) === String(item.id))) acc.push(item);
          return acc;
        }, [])
        .sort((a, b) => new Date(a.dueDateTime) - new Date(b.dueDateTime));

      setMeetings(mergedMeetings);
      setFollowups((followupRes.data || []).map(mapDocToFollowup));
      setDeals((dealRes.data || []).map(mapDealToPipelineItem));
      setLeads((leadRes.data || []).map(mapLeadToPipelineItem));
    } catch (err) {
      console.error(err);
      setError("Failed to load followups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const rawRole = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
    setCurrentRole(rawRole);
    if (rawRole === "admin") setScopeLabel("Admin Scope: My + Managers + Sales");
    else if (rawRole === "manager") setScopeLabel("Manager Scope: My + Team");
    else setScopeLabel("Sales Scope: My Records");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/followups/filter-options");
        setCurrentUserId(String(res.data?.currentUser?.id || ""));
        if (currentRole === "admin" || currentRole === "manager") {
          setTeamOptions(res.data?.teams || []);
          setEmployeeOptions(res.data?.employees || []);
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [currentRole]);

  const visibleStageOptions = useMemo(
    () => (recordBucket === "lead" ? LEAD_STAGES : DEAL_STAGES),
    [recordBucket]
  );

  const visibleEmployeeOptions = useMemo(() => {
    if (!selectedTeamId || selectedTeamId === "__mine__") return employeeOptions;
    const team = teamOptions.find((t) => String(t.id) === String(selectedTeamId));
    const userIds = (team?.userIds || []).map((id) => String(id));
    return employeeOptions.filter((user) => userIds.includes(String(user.id)));
  }, [employeeOptions, selectedTeamId, teamOptions]);

  const bucketedMeetings = useMemo(
    () => meetings.filter((m) => inferRecordBucket(m) === recordBucket),
    [meetings, recordBucket]
  );

  const bucketedFollowups = useMemo(
    () => followups.filter((f) => inferRecordBucket(f) === recordBucket),
    [followups, recordBucket]
  );

  const assigneeFilteredMeetings = useMemo(
    () =>
      bucketedMeetings.filter((m) =>
        matchesAssigneeFilter({
          item: m,
          recordScope,
          selectedEmployeeId,
          selectedTeamId,
          currentUserId,
          teamOptions,
        })
      ),
    [bucketedMeetings, recordScope, selectedEmployeeId, selectedTeamId, currentUserId, teamOptions]
  );

  const assigneeFilteredFollowups = useMemo(
    () =>
      bucketedFollowups.filter((f) =>
        matchesAssigneeFilter({
          item: f,
          recordScope,
          selectedEmployeeId,
          selectedTeamId,
          currentUserId,
          teamOptions,
        })
      ),
    [bucketedFollowups, recordScope, selectedEmployeeId, selectedTeamId, currentUserId, teamOptions]
  );

  const assigneeFilteredDeals = useMemo(
    () =>
      deals.filter((deal) =>
        matchesAssigneeFilter({
          item: deal,
          recordScope,
          selectedEmployeeId,
          selectedTeamId,
          currentUserId,
          teamOptions,
        })
      ),
    [deals, recordScope, selectedEmployeeId, selectedTeamId, currentUserId, teamOptions]
  );

  const assigneeFilteredLeads = useMemo(
    () =>
      leads.filter((lead) =>
        matchesAssigneeFilter({
          item: lead,
          recordScope,
          selectedEmployeeId,
          selectedTeamId,
          currentUserId,
          teamOptions,
        })
      ),
    [leads, recordScope, selectedEmployeeId, selectedTeamId, currentUserId, teamOptions]
  );

  const stageCounts = useMemo(() => {
    const map = Object.fromEntries(visibleStageOptions.map((s) => [s.key, 0]));

    if (recordBucket === "deal") {
      assigneeFilteredDeals.forEach((deal) => {
        if (!deal?.stage || !(deal.stage in map)) return;
        if (!shouldCountDealInStage(deal, deal.stage)) return;
        map[deal.stage] = (map[deal.stage] || 0) + 1;
      });
      return map;
    }

    assigneeFilteredLeads.forEach((lead) => {
      if (!lead?.stage || !(lead.stage in map)) return;
      map[lead.stage] = (map[lead.stage] || 0) + 1;
    });
    return map;
  }, [assigneeFilteredDeals, assigneeFilteredLeads, recordBucket, visibleStageOptions]);

  const visibleFollowups = useMemo(
    () => (useStageFilter ? assigneeFilteredFollowups.filter((f) => f.stage === activeStage) : assigneeFilteredFollowups),
    [assigneeFilteredFollowups, activeStage, useStageFilter]
  );

  const filteredMeetings = useMemo(
    () => assigneeFilteredMeetings.filter((m) => {
      const todayMatch = isOnLocalDate(
        getRelevantDateForStatus(m, statusFilter),
        getLocalDateISO()
      );
      const statusMatch =
        statusFilter === "completed"
          ? isCompletedStatus(m.status)
          : statusFilter === "remaining"
            ? !isCompletedStatus(m.status)
            : true;
      return todayMatch && statusMatch;
    }),
    [assigneeFilteredMeetings, statusFilter]
  );

  const filteredFollowupsByStatus = useMemo(
    () => assigneeFilteredFollowups.filter((f) => {
      const todayMatch = isOnLocalDate(
        getRelevantDateForStatus(f, statusFilter),
        getLocalDateISO()
      );
      const statusMatch =
        statusFilter === "completed"
          ? isCompletedStatus(f.status)
          : statusFilter === "remaining"
            ? !isCompletedStatus(f.status)
            : true;
      return todayMatch && statusMatch;
    }),
    [assigneeFilteredFollowups, statusFilter]
  );

  const meetingTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredMeetings.length / PAGE_SIZE)),
    [filteredMeetings]
  );
  const followupTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredFollowupsByStatus.length / PAGE_SIZE)),
    [filteredFollowupsByStatus]
  );

  const visibleMeetings = useMemo(() => {
    const start = (meetingPage - 1) * PAGE_SIZE;
    return filteredMeetings.slice(start, start + PAGE_SIZE);
  }, [filteredMeetings, meetingPage]);

  const visibleFollowupsByStatus = useMemo(() => {
    const start = (followupPage - 1) * PAGE_SIZE;
    return filteredFollowupsByStatus.slice(start, start + PAGE_SIZE);
  }, [filteredFollowupsByStatus, followupPage]);

  const handleMeetingPageChange = (page) => {
    const nextPage = Math.min(Math.max(page, 1), meetingTotalPages);
    setMeetingPage(nextPage);
  };

  const handleFollowupPageChange = (page) => {
    const nextPage = Math.min(Math.max(page, 1), followupTotalPages);
    setFollowupPage(nextPage);
  };

  const statusCounts = useMemo(() => {
    const meetingRemaining = assigneeFilteredMeetings.filter(
      (m) =>
        isOnLocalDate(getRelevantDateForStatus(m, "remaining"), getLocalDateISO()) &&
        !isCompletedStatus(m.status)
    ).length;
    const meetingCompleted = assigneeFilteredMeetings.filter(
      (m) =>
        isOnLocalDate(getRelevantDateForStatus(m, "completed"), getLocalDateISO()) &&
        isCompletedStatus(m.status)
    ).length;
    const followupRemaining = assigneeFilteredFollowups.filter(
      (f) =>
        isOnLocalDate(getRelevantDateForStatus(f, "remaining"), getLocalDateISO()) &&
        !isCompletedStatus(f.status)
    ).length;
    const followupCompleted = assigneeFilteredFollowups.filter(
      (f) =>
        isOnLocalDate(getRelevantDateForStatus(f, "completed"), getLocalDateISO()) &&
        isCompletedStatus(f.status)
    ).length;
    return {
      all: meetingRemaining + meetingCompleted + followupRemaining + followupCompleted,
      remaining: meetingRemaining + followupRemaining,
      completed: meetingCompleted + followupCompleted,
    };
  }, [assigneeFilteredMeetings, assigneeFilteredFollowups]);

  useEffect(() => {
    if (!useStageFilter) return;
    if (!visibleStageOptions.some((stage) => stage.key === activeStage)) {
      setActiveStage(visibleStageOptions[0]?.key || "P1");
    }
  }, [activeStage, visibleStageOptions, useStageFilter]);

  useEffect(() => {
    setMeetingPage(1);
    setFollowupPage(1);
  }, [statusFilter, activeStage, selectedTeamId, selectedEmployeeId, recordScope]);

  useEffect(() => {
    if (meetingPage > meetingTotalPages) setMeetingPage(meetingTotalPages);
  }, [meetingPage, meetingTotalPages]);

  useEffect(() => {
    if (followupPage > followupTotalPages) setFollowupPage(followupTotalPages);
  }, [followupPage, followupTotalPages]);

  const getExistingReasonForLost = (source = {}) => {
    if (source?.dealId) {
      return deals.find((deal) => String(deal.id) === String(source.dealId))?.reasonForLost || "";
    }
    if (source?.leadId) {
      return leads.find((lead) => String(lead.id) === String(source.leadId))?.reasonForLost || "";
    }
    return "";
  };

  const handleMeetingDone = async (id) => {
    const meeting = meetings.find((m) => String(m.id) === String(id)) || selectedMeeting;
    if (!meeting || isCompletedStatus(meeting.status) || isCancelledStatus(meeting.status)) return;
    setDoneModal({
      open: true,
      id: String(id),
      kind: "meeting",
      durationMinutes: meeting?.durationMinutes ? String(meeting.durationMinutes) : "",
      minutesOfMeeting: meeting?.notes || "",
      nextFollowup: "no",
      nextFollowupDate: "",
      nextReminder: "yes",
      nextStage: meeting?.stage || activeStage || "P1",
      reasonForLost: getExistingReasonForLost(meeting),
      sourceData: meeting || null,
    });
    setDoneModalError("");
  };

  const closeDoneModal = () => {
    if (savingDone) return;
    setDoneModal({ open: false, ...EMPTY_DONE_MODAL });
    setDoneModalError("");
  };

  const showSuccessModal = (title, subtitle = "") => {
    setSuccessModal({ open: true, title, subtitle });
    setTimeout(() => {
      setSuccessModal({ open: false, title: "", subtitle: "" });
    }, 3000);
  };

  const submitMeetingDone = async (e) => {
    e.preventDefault();
    setDoneModalError("");

    if (!doneModal.durationMinutes || Number(doneModal.durationMinutes) < 1) {
      return setDoneModalError("Duration of minutes is required");
    }
    const completionError = minLength(
      doneModal.minutesOfMeeting,
      3,
      doneModal.kind === "meeting" ? "Minutes of meeting" : "Completion notes"
    );
    if (completionError) return setDoneModalError(completionError);
    if (doneModal.nextFollowup === "yes" && !doneModal.nextFollowupDate) {
      return setDoneModalError("Next follow-up date is required");
    }
    const needsReasonForLost = requiresReasonForLost(doneModal.nextStage, doneModal.sourceData);
    const trimmedReasonForLost = String(doneModal.reasonForLost || "").trim();
    const existingReasonForLost = String(getExistingReasonForLost(doneModal.sourceData) || "").trim();
    if (needsReasonForLost) {
      const reasonError = minLength(trimmedReasonForLost, 3, "Reason for lost");
      if (reasonError) return setDoneModalError(reasonError);
    }

    try {
      setSavingDone(true);
      let nextRecord = null;
      const res = await API.patch(`/followups/${doneModal.id}/status`, {
        status: "completed",
        durationMinutes: Number(doneModal.durationMinutes),
        notes: doneModal.minutesOfMeeting.trim(),
      });

      // Update lead/deal stage to match the selected stage
      const source = doneModal.sourceData || {};
      const shouldSyncLinkedEntity =
        Boolean(doneModal.nextStage) &&
        (
          doneModal.nextStage !== source.stage ||
          (needsReasonForLost && trimmedReasonForLost !== existingReasonForLost)
        );
      if (shouldSyncLinkedEntity) {
        try {
          if (source.leadId) {
            await API.put(`/leads/${source.leadId}`, {
              stage: doneModal.nextStage,
              ...(needsReasonForLost ? { reason_for_lost: trimmedReasonForLost } : {}),
            });
            setLeads((prev) =>
              prev.map((lead) =>
                String(lead.id) === String(source.leadId)
                  ? {
                      ...lead,
                      stage: doneModal.nextStage,
                      reasonForLost: needsReasonForLost ? trimmedReasonForLost : lead.reasonForLost,
                    }
                  : lead
              )
            );
          } else if (source.dealId) {
            await API.put(`/deals/${source.dealId}`, {
              stage: doneModal.nextStage,
              ...(needsReasonForLost ? { reason_for_lost: trimmedReasonForLost } : {}),
            });
            setDeals((prev) =>
              prev.map((deal) =>
                String(deal.id) === String(source.dealId)
                  ? {
                      ...deal,
                      stage: doneModal.nextStage,
                      reasonForLost: needsReasonForLost ? trimmedReasonForLost : deal.reasonForLost,
                    }
                  : deal
              )
            );
          }
        } catch (err) {
          console.error("Failed to update lead/deal stage:", err);
          // Continue with the rest of the process even if stage update fails
        }
      }

      if (doneModal.nextFollowup === "yes") {
        const source = doneModal.sourceData || {};
        const nextDueDateTime = combineDateWithBaseTime(doneModal.nextFollowupDate, source.dueDateTime);
        if (!nextDueDateTime) {
          throw new Error("Invalid next follow-up date");
        }

        const isMeetingSource = doneModal.kind === "meeting";
        const nextPayload = {
          kind: isMeetingSource ? "meeting" : "followup",
          actionType: isMeetingSource
            ? (source.eventType || "Meeting")
            : (source.actionType || "Follow Up Phone Call"),
          title: String(source.title || source.eventType || source.actionType || "Follow-up").trim(),
          clientName: String(source.clientName || source.client || "").trim(),
          leadId: source.leadId || undefined,
          dealId: source.dealId || undefined,
          clientId: source.clientId || undefined,
          stage: doneModal.nextStage || source.stage || "P1",
          priority: source.priority || "medium",
          dueDateTime: nextDueDateTime,
          reminderEnabled: doneModal.nextReminder === "yes",
          notes: "",
          agenda: source.agenda || "",
          assignedTo: source.assignedToId || undefined,
          status: "pending",
        };

        const createRes = await API.post("/followups", nextPayload);
        nextRecord = createRes.data;
      }

      if (doneModal.kind === "meeting") {
        const updated = {
          ...mapDocToMeeting(res.data),
          stage: doneModal.nextStage || mapDocToMeeting(res.data).stage,
          status: "completed",
        };
        setMeetings((prev) => prev.map((m) => (m.id === doneModal.id ? { ...m, ...updated } : m)));
        if (selectedMeeting?.id === doneModal.id) {
          setSelectedMeeting((prev) => ({ ...prev, ...updated }));
        }
      } else {
        const updated = {
          ...mapDocToFollowup(res.data),
          stage: doneModal.nextStage || mapDocToFollowup(res.data).stage,
        };
        setFollowups((prev) => prev.map((x) => (x.id === doneModal.id ? updated : x)));
        if (selectedFollowup?.id === doneModal.id) {
          setSelectedFollowup(updated);
        }
      }

      if (nextRecord) {
        if (isMeetingLikeAction(nextRecord.actionType) || nextRecord.kind === "meeting") {
          const nextMeeting = mapDocToMeeting(nextRecord);
          setMeetings((prev) => [nextMeeting, ...prev]);
        } else {
          const nextFollowup = mapDocToFollowup(nextRecord);
          setFollowups((prev) => [nextFollowup, ...prev]);
        }
      }

      const messageType = doneModal.kind === "meeting" ? "Meeting" : "Followup";
      showSuccessModal(`${messageType} Completed Successfully`);

      setDoneModal({ open: false, ...EMPTY_DONE_MODAL });
    } catch (err) {
      console.error(err);
      setDoneModalError(err?.response?.data?.message || err?.message || `Failed to complete ${doneModal.kind}`);
    } finally {
      setSavingDone(false);
    }
  };

  const markDone = async (id) => {
    const followup = followups.find((f) => String(f.id) === String(id)) || selectedFollowup;
    if (!followup || isCompletedStatus(followup.status) || isCancelledStatus(followup.status)) return;
    setDoneModal({
      open: true,
      id: String(id),
      kind: "followup",
      durationMinutes: followup?.durationMinutes ? String(followup.durationMinutes) : "",
      minutesOfMeeting: followup?.notes || "",
      nextFollowup: "no",
      nextFollowupDate: "",
      nextReminder: "yes",
      nextStage: followup?.stage || activeStage || "P1",
      reasonForLost: getExistingReasonForLost(followup),
      sourceData: followup || null,
    });
    setDoneModalError("");
  };

  const openCancelModal = ({ kind, item }) => {
    const targetId = String(item?.id || "");
    if (!targetId) return;
    if (isCompletedStatus(item?.status) || isCancelledStatus(item?.status)) return;
    setCancelModal({
      open: true,
      id: targetId,
      kind: kind === "meeting" ? "meeting" : "followup",
      reason: "",
    });
    setCancelModalError("");
  };

  const closeCancelModal = () => {
    if (savingCancel) return;
    setCancelModal(EMPTY_CANCEL_MODAL);
    setCancelModalError("");
  };

  const submitCancel = async (e) => {
    e.preventDefault();
    setCancelModalError("");
    const targetId = String(cancelModal.id || "");
    const trimmedReason = String(cancelModal.reason || "").trim();
    if (!targetId) return setCancelModalError("Record id is missing");
    const reasonError = minLength(trimmedReason, 3, "Cancellation reason");
    if (reasonError) return setCancelModalError(reasonError);
    try {
      setSavingCancel(true);
      const res = await API.patch(`/followups/${targetId}/status`, {
        status: "cancelled",
        cancelReason: trimmedReason,
      });

      if (cancelModal.kind === "meeting") {
        const updated = mapDocToMeeting(res.data);
        setMeetings((prev) => prev.map((m) => (String(m.id) === targetId ? { ...m, ...updated, status: "cancelled" } : m)));
        if (selectedMeeting?.id === targetId) {
          setSelectedMeeting((prev) => ({ ...prev, ...updated, status: "cancelled" }));
        }
      } else {
        const updated = mapDocToFollowup(res.data);
        setFollowups((prev) => prev.map((f) => (String(f.id) === targetId ? updated : f)));
        if (selectedFollowup?.id === targetId) {
          setSelectedFollowup(updated);
        }
      }
      setCancelModal(EMPTY_CANCEL_MODAL);
      showSuccessModal(
        `${cancelModal.kind === "meeting" ? "Meeting" : "Follow-up"} Cancelled Successfully`
      );
    } catch (err) {
      console.error(err);
      setCancelModalError(err?.response?.data?.message || "Failed to cancel record");
    } finally {
      setSavingCancel(false);
    }
  };

  const openFollowupView = (item) => {
    setSelectedFollowup(item);
    setFollowupMode("view");
  };

  const openFollowupEdit = (item) => {
    if (isCancelledStatus(item?.status)) return;
    setEditingFollowupId(item.id);
    setFormError("");
    setFollowupForm({
      client: item.client || "",
      title: item.title || "",
      dueDateTime: toInputDateTime(item.dueDateTime),
      stage: item.stage || activeStage,
      priority: item.priority || "medium",
    });
    setFollowupMode("edit");
  };

  const openMeetingView = (item) => {
    setSelectedMeeting(item);
    setMeetingMode("view");
  };

  const openMeetingEdit = (item) => {
    if (isCancelledStatus(item?.status)) return;
    setEditingMeetingId(item.id);
    setMeetingFormError("");
    setMeetingForm({
      client: item.clientName || "",
      title: item.title || item.eventType || "",
      dueDateTime: toInputDateTime(item.dueDateTime),
      meetingLocation: item.address || "",
      meetingExactLocation: item.exactLocation || "",
      priority: item.priority || "medium",
      minutesOfMeeting: item.notes || "",
      status: item.status || "pending",
    });
    setMeetingMode("edit");
  };

  const submitMeetingEdit = async (e) => {
    e.preventDefault();
    setMeetingFormError("");
    const isEditableMeeting = selectedMeeting && !isCancelledStatus(selectedMeeting.status);
    const allowLocationEdit =
      isEditableMeeting &&
      !isCompletedStatus(selectedMeeting.status) &&
      isPhysicalMeetingEvent(selectedMeeting.eventType);

    const meetingChecks = [
      required(meetingForm.dueDateTime, "Date & time"),
    ];
    const meetingError = meetingChecks.find(Boolean) || "";
    if (meetingError) return setMeetingFormError(meetingError);

    try {
      const payload = {
        dueDateTime: new Date(meetingForm.dueDateTime).toISOString(),
        priority: meetingForm.priority,
      };
      if (allowLocationEdit) {
        payload.meetingLocation = String(meetingForm.meetingLocation || "").trim();
        payload.meetingExactLocation = String(meetingForm.meetingExactLocation || "").trim();
        payload.address = payload.meetingLocation;
        payload.exactLocation = payload.meetingExactLocation;
      }

      const res = await API.put(`/followups/${editingMeetingId}`, payload);
      const updated = mapDocToMeeting(res.data);

      setMeetings((prev) => prev.map((m) => (m.id === editingMeetingId ? updated : m)));
      setSelectedMeeting(updated);
      setEditingMeetingId(null);
      setMeetingMode("view");
      showSuccessModal("Meeting Updated Successfully");
    } catch (err) {
      console.error(err);
      setMeetingFormError(err?.response?.data?.errors?.[0] || "Failed to update meeting");
    }
  };

  const submitFollowupEdit = async (e) => {
    e.preventDefault();
    setFormError("");

    const followupChecks = [
      required(followupForm.dueDateTime, "Date & time"),
    ];
    const followupError = followupChecks.find(Boolean) || "";
    if (followupError) return setFormError(followupError);

    try {
      const payload = {
        dueDateTime: new Date(followupForm.dueDateTime).toISOString(),
        priority: followupForm.priority,
      };

      const res = await API.put(`/followups/${editingFollowupId}`, payload);
      const updated = mapDocToFollowup(res.data);

      setFollowups((prev) => prev.map((f) => (f.id === editingFollowupId ? updated : f)));
      setSelectedFollowup(updated);
      setEditingFollowupId(null);
      setFollowupMode("list");
      showSuccessModal("Follow-up Updated Successfully");
    } catch (err) {
      console.error(err);
      setFormError(err?.response?.data?.errors?.[0] || "Failed to update follow-up");
    }
  };

  return (
    <div className="fuPage">
      {useStageFilter && (
        <div className={cx("fuStages", recordBucket === "deal" && "fuStagesDeal")} role="tablist" aria-label="Follow-up stages">
          {visibleStageOptions.map((s) => (
            !s.hidden ? (
              <button
                key={s.key}
                className={cx("fuStageCard", `stage-${String(s.key || "").toLowerCase()}`, activeStage === s.key && "active")}
                onClick={() => {
                  setActiveStage(s.key);
                  if (followupMode === "all") setFollowupMode("list");
                }}
                type="button"
              >
                <div className="fuStageTop"><span className="fuStageTitle">{s.title}</span></div>
                <div className="fuStageMid"><span className="fuStageCount">{stageCounts[s.key] ?? 0}</span></div>
                <div className="fuStageSub">{s.sub}</div>
              </button>
            ) : null
          ))}
        </div>
      )}
      <div className="fuTopbar">
        <div className="fuTopbarLeft">
          <div className="fuTopbarGroup">
            <button
              className={cx("fuTopbarBtn", statusFilter === "all" && "active")}
              type="button"
              onClick={() => setStatusFilter("all")}
            >
              All ({statusCounts.all})
            </button>
            <button
              className={cx("fuTopbarBtn", statusFilter === "remaining" && "active")}
              type="button"
              onClick={() => setStatusFilter("remaining")}
            >
              Remaining ({statusCounts.remaining})
            </button>
            <button
              className={cx("fuTopbarBtn", statusFilter === "completed" && "active")}
              type="button"
              onClick={() => setStatusFilter("completed")}
            >
              Completed ({statusCounts.completed})
            </button>
          </div>
          <div className="fuTopbarGroup">
            <button
              className={cx("fuTopbarBtn", recordBucket === "lead" && "active")}
              type="button"
              onClick={() => setRecordBucket("lead")}
            >
              Lead
            </button>
            <button
              className={cx("fuTopbarBtn", recordBucket === "deal" && "active")}
              type="button"
              onClick={() => setRecordBucket("deal")}
            >
              Deal
            </button>
          </div>
        </div>
        {(currentRole === "admin" || currentRole === "manager") && (
          <div className="fuTopbarFilters">
            <select
              className="fuTopbarSelect"
              value={recordScope}
              onChange={(e) => {
                const nextScope = e.target.value;
                setRecordScope(nextScope);
                if (nextScope === "mine") {
                  setSelectedTeamId("");
                  setSelectedEmployeeId("");
                }
              }}
            >
              <option value="mine">My Records</option>
              <option value="all">Select</option>
            </select>
            <select
              className="fuTopbarSelect"
              value={selectedTeamId}
              disabled={recordScope === "mine"}
              onChange={(e) => {
                setRecordScope("all");
                setSelectedTeamId(e.target.value);
                setSelectedEmployeeId("");
              }}
            >
              <option value="">All Teams</option>
              <option value="__mine__">My Records</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select
              className="fuTopbarSelect"
              value={selectedEmployeeId}
              disabled={recordScope === "mine"}
              onChange={(e) => {
                setRecordScope("all");
                setSelectedEmployeeId(e.target.value);
                if (e.target.value) setSelectedTeamId("");
              }}
            >
              <option value="">All Employees</option>
              <option value="__mine__">My Records</option>
              {visibleEmployeeOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="fuGrid">
        <section className="fuPanel fuPanelFixed">
          <header className="fuPanelHeader">
            <h3>Today's Meeting List</h3>
          </header>

          <div className="fuPanelBody">
            {loading ? (
              <div className="fuEmptyBox">Loading meetings...</div>
            ) : (
              <>
                <div className="fuList">
                  {visibleMeetings.length === 0 ? (
                    <div className="fuEmptyBox">
                      {statusFilter === "completed"
                        ? "No completed meetings for today."
                        : statusFilter === "remaining"
                          ? "No remaining meetings for today."
                          : "No meetings for today."}
                    </div>
                  ) : (
                    visibleMeetings.map((m) => (
                      <div key={m.id} className="fuItem">
                        <div className={cx("fuPriorityDot", m.priority)} title={`${m.priority} priority`} />
                        <div className="fuItemMain">
                          <div className="fuItemTitle">{m.clientName} - {m.title || m.eventType}</div>
                          <div className="fuItemMeta">
                            <span className="fuMetaChip">{m.eventType}</span>
                            <span className="fuMetaChip">Time: {m.time}</span>
                            {m.aiPriority ? (
                              <span className={cx("fuMetaChip", "fuAiPriorityChip", getAiPriorityClass(m.aiPriority))}>AI: {m.aiPriority}</span>
                            ) : null}
                            {!isCompletedStatus(m.status) && (
                              <span className="fuMetaChip">{m.status}</span>
                            )}
                          </div>
                        </div>
                        <div className="fuItemActions">
                          <button className="fuMiniBtn" type="button" onClick={() => openMeetingView(m)}>View</button>
                          <button
                            className={cx("fuMiniBtn", "done", isCompletedStatus(m.status) && "completed")}
                            type="button"
                            onClick={() => handleMeetingDone(m.id)}
                            disabled={isCompletedStatus(m.status) || isCancelledStatus(m.status)}
                          >
                            {isCompletedStatus(m.status) ? "Completed" : "Done"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {filteredMeetings.length > 0 && (
                  <Pagination
                    currentPage={meetingPage}
                    totalPages={meetingTotalPages}
                    handlePageChange={handleMeetingPageChange}
                  />
                )}
              </>
            )}
          </div>
        </section>

        <section className="fuPanel fuPanelFixed">
          <header className="fuPanelHeader">
            <div>
              <h3>Active Follow-ups</h3>
              <div className="fuHint">Showing: <span className="fuHintStrong">Today's follow-ups</span></div>
            </div>
          </header>

          <div className="fuPanelBody">
            <>
              <div className="fuList">
                {loading ? (
                  <div className="fuEmptyBox">Loading follow-ups...</div>
                ) : visibleFollowupsByStatus.length === 0 ? (
                  <div className="fuEmptyBox">
                    {statusFilter === "completed"
                      ? "No completed follow-ups for today."
                      : statusFilter === "remaining"
                        ? "No remaining follow-ups for today."
                        : "No follow-ups for today."}
                  </div>
                ) : (
                  visibleFollowupsByStatus.map((f) => (
                    <div key={f.id} className="fuItem">
                      <div className={cx("fuPriorityDot", f.priority)} title={`${f.priority} priority`} />
                      <div className="fuItemMain">
                        <div className="fuItemTitle">{f.client} - {f.title}</div>
                        <div className="fuItemMeta">
                          <span className="fuMetaChip">{String(f.actionType || "").replace(/^follow\s*up\s*/i, "").trim() || "Phone Call"}</span>
                          <span className="fuMetaChip">Time: {f.time || "--:--"}</span>
                          <span className="fuMetaChip">Mob: {f.mob || "-"}</span>
                          {f.aiPriority ? (
                            <span className={cx("fuMetaChip", "fuAiPriorityChip", getAiPriorityClass(f.aiPriority))}>AI: {f.aiPriority}</span>
                          ) : null}
                          <span className="fuMetaChip">{f.status || "pending"}</span>
                        </div>
                      </div>
                      <div className="fuItemActions">
                        <button className="fuMiniBtn" type="button" onClick={() => openFollowupView(f)}>View</button>
                        <button
                          className={cx("fuMiniBtn", "done", isCompletedStatus(f.status) && "completed")}
                          type="button"
                          onClick={() => markDone(f.id)}
                          disabled={isCompletedStatus(f.status) || isCancelledStatus(f.status)}
                        >
                          {isCompletedStatus(f.status) ? "Completed" : "Done"}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {filteredFollowupsByStatus.length > 0 && (
                <Pagination
                  currentPage={followupPage}
                  totalPages={followupTotalPages}
                  handlePageChange={handleFollowupPageChange}
                />
              )}
            </>
          </div>
        </section>
      </div>

      {meetingMode === "view" && selectedMeeting && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label="View Meeting">
          <div className="fuModalCard">
            <div className="fuDetailsHead">
              <div className="fuAllTitle">Today's Meeting Details</div>
              <div className="fuPanelActions">
                {!isCompletedStatus(selectedMeeting.status) && !isCancelledStatus(selectedMeeting.status) && (
                  <button
                    className="fuBtn fuBtnPrimary"
                    type="button"
                    onClick={() => openMeetingEdit(selectedMeeting)}
                  >
                    Edit
                  </button>
                )}
                {!isCompletedStatus(selectedMeeting.status) && !isCancelledStatus(selectedMeeting.status) && (
                  <button
                    className="fuBtn fuBtnGhost"
                    type="button"
                    onClick={() => openCancelModal({ kind: "meeting", item: selectedMeeting })}
                  >
                    Cancel
                  </button>
                )}
                <button className="fuBtn fuBtnGhost" type="button" onClick={() => setMeetingMode("list")}>Back</button>
              </div>
            </div>
            <div className="fuDetailsGrid">
              <div className="fuDetailCard"><div className="k">Client</div><div className="v">{selectedMeeting.clientName}</div></div>
              <div className="fuDetailCard"><div className="k">Task</div><div className="v">{selectedMeeting.title || selectedMeeting.eventType}</div></div>
              <div className="fuDetailCard"><div className="k">Meeting Location</div><div className="v">{selectedMeeting.address || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Stage</div><div className="v">{selectedMeeting.stage || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Event Type</div><div className="v">{selectedMeeting.eventType}</div></div>
              <div className="fuDetailCard"><div className="k">Time</div><div className="v">{selectedMeeting.time}</div></div>
              <div className="fuDetailCard"><div className="k">Due</div><div className="v">{selectedMeeting.due}</div></div>
              <div className="fuDetailCard"><div className="k">Priority</div><div className="v">{selectedMeeting.priority}</div></div>
              <div className="fuDetailCard"><div className="k">AI Priority</div><div className="v">{selectedMeeting.aiPriority || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Status</div><div className="v">{selectedMeeting.status}</div></div>
              <div className="fuDetailCard"><div className="k">Duration (Minutes)</div><div className="v">{selectedMeeting.durationMinutes || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Agenda</div><div className="v">{selectedMeeting.agenda || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Minutes of Meeting</div><div className="v">{selectedMeeting.notes || "-"}</div></div>
              {isPhysicalMeetingEvent(selectedMeeting.eventType) && (
                <>
                  <div className="fuDetailCard"><div className="k">Address</div><div className="v">{selectedMeeting.address || "-"}</div></div>
                  <div className="fuDetailCard"><div className="k">Location</div><div className="v">{selectedMeeting.exactLocation || "-"}</div></div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {meetingMode === "edit" && selectedMeeting && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label="Edit Meeting">
          <form className="fuModalCard" onSubmit={submitMeetingEdit}>
            <div className="fuFormTitle">Edit Meeting</div>
            {!isCancelledStatus(selectedMeeting.status) ? (
              <div className="fuFormGrid">
                <label className="fuFormLabel fuFull">
                  Date & Time*
                  <input className="fuField" type="datetime-local" value={meetingForm.dueDateTime} onChange={(e) => setMeetingForm((p) => ({ ...p, dueDateTime: e.target.value }))} />
                </label>
                <label className="fuFormLabel">
                  Priority
                  <select className="fuField" value={meetingForm.priority} onChange={(e) => setMeetingForm((p) => ({ ...p, priority: e.target.value }))}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                {!isCompletedStatus(selectedMeeting.status) && isPhysicalMeetingEvent(selectedMeeting.eventType) && (
                  <>
                    <label className="fuFormLabel fuFull">
                      Meeting Location
                      <input className="fuField" type="text" value={meetingForm.meetingLocation} onChange={(e) => setMeetingForm((p) => ({ ...p, meetingLocation: e.target.value }))} />
                    </label>
                    <label className="fuFormLabel fuFull">
                      Exact Location
                      <input className="fuField" type="text" value={meetingForm.meetingExactLocation} onChange={(e) => setMeetingForm((p) => ({ ...p, meetingExactLocation: e.target.value }))} />
                    </label>
                  </>
                )}
              </div>
            ) : (
            <div className="fuFormGrid">
              <label className="fuFormLabel">
                Client*
                <input className="fuField" type="text" value={meetingForm.client} onChange={(e) => setMeetingForm((p) => ({ ...p, client: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Priority
                <select className="fuField" value={meetingForm.priority} onChange={(e) => setMeetingForm((p) => ({ ...p, priority: e.target.value }))}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="fuFormLabel fuFull">
                Task*
                <input className="fuField" type="text" value={meetingForm.title} onChange={(e) => setMeetingForm((p) => ({ ...p, title: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Date & Time*
                <input className="fuField" type="datetime-local" value={meetingForm.dueDateTime} onChange={(e) => setMeetingForm((p) => ({ ...p, dueDateTime: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Status
                <select className="fuField" value={meetingForm.status} onChange={(e) => setMeetingForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              {isCompletedStatus(meetingForm.status) && (
                <label className="fuFormLabel fuFull">
                  Minutes of Meeting*
                  <textarea
                    className="fuField fuTextarea"
                    rows={4}
                    value={meetingForm.minutesOfMeeting}
                    onChange={(e) => setMeetingForm((p) => ({ ...p, minutesOfMeeting: e.target.value }))}
                  />
                </label>
              )}
            </div>
            )}
            <FormErrorSlot message={meetingFormError} className="form-error-slot-global" />
            <div className="fuFormActions">
              <button className="fuBtn fuBtnPrimary" type="submit">Save</button>
              <button className="fuBtn fuBtnGhost" type="button" onClick={() => setMeetingMode("view")}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {followupMode === "view" && selectedFollowup && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label="View Follow-up">
          <div className="fuModalCard">
            <div className="fuDetailsHead">
              <div className="fuAllTitle">Follow-up Details</div>
              <div className="fuPanelActions">
                {!isCompletedStatus(selectedFollowup.status) && !isCancelledStatus(selectedFollowup.status) && (
                  <button
                    className="fuBtn fuBtnPrimary"
                    type="button"
                    onClick={() => openFollowupEdit(selectedFollowup)}
                  >
                    Edit
                  </button>
                )}
                {!isCompletedStatus(selectedFollowup.status) && !isCancelledStatus(selectedFollowup.status) && (
                  <button
                    className="fuBtn fuBtnGhost"
                    type="button"
                    onClick={() => openCancelModal({ kind: "followup", item: selectedFollowup })}
                  >
                    Cancel
                  </button>
                )}
                <button className="fuBtn fuBtnGhost" type="button" onClick={() => setFollowupMode("list")}>Back</button>
              </div>
            </div>
            <div className="fuDetailsGrid">
              <div className="fuDetailCard"><div className="k">Client</div><div className="v">{selectedFollowup.client}</div></div>
              <div className="fuDetailCard"><div className="k">Task</div><div className="v">{selectedFollowup.title}</div></div>
              <div className="fuDetailCard"><div className="k">Assigned To</div><div className="v">{selectedFollowup.assignedToName || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Stage</div><div className="v">{selectedFollowup.stage}</div></div>
              <div className="fuDetailCard"><div className="k">Due</div><div className="v">{selectedFollowup.due}</div></div>
              <div className="fuDetailCard"><div className="k">Priority</div><div className="v">{selectedFollowup.priority}</div></div>
              <div className="fuDetailCard"><div className="k">AI Priority</div><div className="v">{selectedFollowup.aiPriority || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Status</div><div className="v">{selectedFollowup.status}</div></div>
              <div className="fuDetailCard"><div className="k">Action Type</div><div className="v">{selectedFollowup.actionType || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Reminder</div><div className="v">{selectedFollowup.reminderEnabled === "no" ? "No" : "Yes"}</div></div>
              <div className="fuDetailCard"><div className="k">Agenda</div><div className="v">{selectedFollowup.agenda || "-"}</div></div>
              <div className="fuDetailCard"><div className="k">Notes</div><div className="v">{selectedFollowup.notes || "-"}</div></div>
            </div>
          </div>
        </div>
      )}

      {followupMode === "edit" && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label="Edit Follow-up">
          <form className="fuModalCard" onSubmit={submitFollowupEdit}>
            <div className="fuFormTitle">Edit Follow-up</div>
            {selectedFollowup && !isCancelledStatus(selectedFollowup.status) ? (
              <div className="fuFormGrid">
                <label className="fuFormLabel fuFull">
                  Date & Time*
                  <input className="fuField" type="datetime-local" value={followupForm.dueDateTime} onChange={(e) => setFollowupForm((p) => ({ ...p, dueDateTime: e.target.value }))} />
                </label>
                <label className="fuFormLabel">
                  Priority
                  <select className="fuField" value={followupForm.priority} onChange={(e) => setFollowupForm((p) => ({ ...p, priority: e.target.value }))}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
            ) : (
            <div className="fuFormGrid">
              <label className="fuFormLabel">
                Client*
                <input className="fuField" type="text" value={followupForm.client} onChange={(e) => setFollowupForm((p) => ({ ...p, client: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Stage
                <select className="fuField" value={followupForm.stage} onChange={(e) => setFollowupForm((p) => ({ ...p, stage: e.target.value }))}>
                  {visibleStageOptions.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
                </select>
              </label>
              <label className="fuFormLabel fuFull">
                Task*
                <input className="fuField" type="text" value={followupForm.title} onChange={(e) => setFollowupForm((p) => ({ ...p, title: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Date & Time*
                <input className="fuField" type="datetime-local" value={followupForm.dueDateTime} onChange={(e) => setFollowupForm((p) => ({ ...p, dueDateTime: e.target.value }))} />
              </label>
              <label className="fuFormLabel">
                Priority
                <select className="fuField" value={followupForm.priority} onChange={(e) => setFollowupForm((p) => ({ ...p, priority: e.target.value }))}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>
            )}
            <FormErrorSlot message={formError} className="form-error-slot-global" />
            <div className="fuFormActions">
              <button className="fuBtn fuBtnPrimary" type="submit">Save</button>
              <button className="fuBtn fuBtnGhost" type="button" onClick={() => setFollowupMode("list")}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {doneModal.open && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label={`Complete ${doneModal.kind}`}>
          <form className="fuModalCard" onSubmit={submitMeetingDone}>
            <div className="fuModalHead">
              <div className="fuFormTitle">{doneModal.kind === "meeting" ? "Complete Meeting" : "Complete Follow-up"}</div>
            </div>
            <div className="fuFormGrid">
              <label className="fuFormLabel">
                Duration of Minutes*
                <input
                  className="fuField"
                  type="number"
                  min="1"
                  value={doneModal.durationMinutes}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, durationMinutes: e.target.value }))}
                />
              </label>
              <label className="fuFormLabel">
                Next Follow-up
                <select
                  className="fuField"
                  value={doneModal.nextFollowup}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, nextFollowup: e.target.value }))}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              <label className="fuFormLabel fuFull">
                {doneModal.kind === "meeting" ? "Minutes Of Meeting (MOM)*" : "Completion Notes*"}
                <textarea
                  className="fuField fuTextarea"
                  rows={5}
                  value={doneModal.minutesOfMeeting}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, minutesOfMeeting: e.target.value }))}
                />
              </label>
              {doneModal.nextFollowup === "yes" && (
                <>
                  <label className="fuFormLabel">
                    Next Follow-up Date*
                    <input
                      className="fuField"
                      type="date"
                      value={doneModal.nextFollowupDate}
                      onChange={(e) => setDoneModal((prev) => ({ ...prev, nextFollowupDate: e.target.value }))}
                    />
                  </label>
                  <label className="fuFormLabel">
                    Reminder (Next Follow-up)
                    <select
                      className="fuField"
                      value={doneModal.nextReminder}
                      onChange={(e) => setDoneModal((prev) => ({ ...prev, nextReminder: e.target.value }))}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </>
              )}
              <label className="fuFormLabel fuFull">
                Stage
                <select
                  className="fuField"
                  value={doneModal.nextStage}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, nextStage: e.target.value }))}
                >
                  {doneModalStageOptions
                    .filter((s) => !s.hidden || s.key === doneModal.nextStage)
                    .map((s) => (
                      <option key={s.key} value={s.key}>{s.title || s.key}</option>
                    ))}
                </select>
              </label>
              {requiresReasonForLost(doneModal.nextStage, doneModal.sourceData) && (
                <label className="fuFormLabel fuFull">
                  Reason For Lost*
                  <textarea
                    className="fuField fuTextarea"
                    rows={4}
                    value={doneModal.reasonForLost}
                    onChange={(e) => setDoneModal((prev) => ({ ...prev, reasonForLost: e.target.value }))}
                  />
                </label>
              )}
            </div>
            <FormErrorSlot message={doneModalError} className="form-error-slot-global" />
            <div className="fuFormActions">
              <button className="fuBtn fuBtnPrimary" type="submit" disabled={savingDone}>
                {savingDone ? "Saving..." : doneModal.kind === "meeting" ? "Save & Complete" : "Save & Mark Done"}
              </button>
              <button className="fuBtn fuBtnGhost" type="button" onClick={closeDoneModal} disabled={savingDone}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {cancelModal.open && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label={`Cancel ${cancelModal.kind}`}>
          <form className="fuModalCard" onSubmit={submitCancel}>
            <div className="fuModalHead">
              <div className="fuFormTitle">Cancel {cancelModal.kind === "meeting" ? "Meeting" : "Follow-up"}</div>
            </div>
            <div className="fuFormGrid">
              <label className="fuFormLabel fuFull">
                Reason for Cancellation*
                <textarea
                  className="fuField fuTextarea"
                  rows={4}
                  value={cancelModal.reason}
                  onChange={(e) => setCancelModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </label>
            </div>
            <FormErrorSlot message={cancelModalError} className="form-error-slot-global" />
            <div className="fuFormActions">
              <button className="fuBtn fuBtnPrimary" type="submit" disabled={savingCancel}>
                {savingCancel ? "Saving..." : "Save Cancellation"}
              </button>
              <button className="fuBtn fuBtnGhost" type="button" onClick={closeCancelModal} disabled={savingCancel}>
                Back
              </button>
            </div>
          </form>
        </div>
      )}
      {successModal.open && (
        <div className="fuModalOverlay" role="dialog" aria-modal="true" aria-label={successModal.title}>
          <div className="fuModalCard fuSuccessModalCard">
            <div className="fuSuccessContent">
              <div className="fuSuccessCheckmark">✓</div>
              <h3 className="fuSuccessTitle">{successModal.title}</h3>
              {successModal.subtitle ? <p className="fuSuccessSubtitle">{successModal.subtitle}</p> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
