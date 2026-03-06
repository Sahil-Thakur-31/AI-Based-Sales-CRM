import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
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
  stage.key === "P7"
    ? { ...stage, title: "P7 - Lead Convert to Deal", sub: "Converted leads" }
    : stage
);

const DEAL_STAGE_KEYS = new Set(["P1", "P2", "P3", "P7"]);
const DEAL_STAGES = STAGES.map((stage) => ({
  ...stage,
  hidden: !DEAL_STAGE_KEYS.has(stage.key),
}));

const EMPTY_FOLLOWUP_FORM = {
  client: "",
  title: "",
  dueDate: "",
  stage: "P1",
  priority: "medium",
};

const EMPTY_MEETING_FORM = {
  client: "",
  title: "",
  dueDateTime: "",
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
  sourceData: null,
};

const EMPTY_CANCEL_MODAL = {
  open: false,
  id: "",
  kind: "followup",
  reason: "",
};

const PAGE_SIZE = 4;

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

function toInputDate(rawDate) {
  if (!rawDate) return "";
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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
    reminderEnabled: doc.reminderEnabled === false ? "no" : "yes",
    completedAt: doc.completedAt || null,
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
  };
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

function matchesAssigneeFilter({
  item,
  recordScope,
  selectedEmployeeId,
  selectedTeamId,
  currentUserId,
  teamOptions,
}) {
  const assignedToId = String(item?.assignedToId || "");

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

export default function Followups() {
  const [activeStage, setActiveStage] = useState("P1");
  const [recordBucket, setRecordBucket] = useState("lead");
  const [followupMode, setFollowupMode] = useState("list");
  const [followups, setFollowups] = useState([]);
  const [meetings, setMeetings] = useState([]);
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
      const [meetingRes, followupRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting" } }),
        API.get("/followups", { params: { kind: "followup" } }),
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

  const stageCounts = useMemo(() => {
    const map = Object.fromEntries(visibleStageOptions.map((s) => [s.key, 0]));
    [...assigneeFilteredFollowups, ...assigneeFilteredMeetings].forEach((item) => {
      if (!isOnLocalDate(item?.dueDateTime, getLocalDateISO())) return;
      if (!item?.stage || !(item.stage in map)) return;
      map[item.stage] = (map[item.stage] || 0) + 1;
    });
    return map;
  }, [assigneeFilteredFollowups, assigneeFilteredMeetings, visibleStageOptions]);

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
      // "Today's Meeting List" should not hide items by stage.
      return todayMatch && statusMatch;
    }),
    [assigneeFilteredMeetings, statusFilter]
  );

  const filteredFollowupsByStatus = useMemo(
    () => visibleFollowups.filter((f) => {
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
    [visibleFollowups, statusFilter]
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
    const followupRemaining = visibleFollowups.filter(
      (f) =>
        isOnLocalDate(getRelevantDateForStatus(f, "remaining"), getLocalDateISO()) &&
        !isCompletedStatus(f.status)
    ).length;
    const followupCompleted = visibleFollowups.filter(
      (f) =>
        isOnLocalDate(getRelevantDateForStatus(f, "completed"), getLocalDateISO()) &&
        isCompletedStatus(f.status)
    ).length;
    return {
      all: meetingRemaining + meetingCompleted + followupRemaining + followupCompleted,
      remaining: meetingRemaining + followupRemaining,
      completed: meetingCompleted + followupCompleted,
    };
  }, [assigneeFilteredMeetings, visibleFollowups]);

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

  const handleMeetingDone = async (id) => {
    const meeting = meetings.find((m) => String(m.id) === String(id)) || selectedMeeting;
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
      sourceData: meeting || null,
    });
    setDoneModalError("");
  };

  const closeDoneModal = () => {
    if (savingDone) return;
    setDoneModal({ open: false, ...EMPTY_DONE_MODAL });
    setDoneModalError("");
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

    try {
      setSavingDone(true);
      let nextRecord = null;
      const res = await API.patch(`/followups/${doneModal.id}/status`, {
        status: "completed",
        durationMinutes: Number(doneModal.durationMinutes),
        notes: doneModal.minutesOfMeeting.trim(),
      });

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
        const updated = mapDocToMeeting(res.data);
        setMeetings((prev) => prev.map((m) => (m.id === doneModal.id ? { ...m, ...updated, status: "completed" } : m)));
        if (selectedMeeting?.id === doneModal.id) {
          setSelectedMeeting((prev) => ({ ...prev, ...updated, status: "completed" }));
        }
      } else {
        const updated = mapDocToFollowup(res.data);
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
        notes: trimmedReason,
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
    setEditingFollowupId(item.id);
    setFormError("");
    setFollowupForm({
      client: item.client || "",
      title: item.title || "",
      dueDate: toInputDate(item.dueDateTime),
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
    setEditingMeetingId(item.id);
    setMeetingFormError("");
    setMeetingForm({
      client: item.clientName || "",
      title: item.title || item.eventType || "",
      dueDateTime: toInputDateTime(item.dueDateTime),
      priority: item.priority || "medium",
      minutesOfMeeting: item.notes || "",
      status: item.status || "pending",
    });
    setMeetingMode("edit");
  };

  const submitMeetingEdit = async (e) => {
    e.preventDefault();
    setMeetingFormError("");

    const meetingChecks = [
      required(meetingForm.client, "Client"),
      required(meetingForm.title, "Task"),
      required(meetingForm.dueDateTime, "Date & time"),
      isCompletedStatus(meetingForm.status)
        ? minLength(meetingForm.minutesOfMeeting, 3, "Minutes of meeting")
        : "",
    ];
    const meetingError = meetingChecks.find(Boolean) || "";
    if (meetingError) return setMeetingFormError(meetingError);

    try {
      const payload = {
        title: meetingForm.title.trim(),
        clientName: meetingForm.client.trim(),
        dueDateTime: new Date(meetingForm.dueDateTime).toISOString(),
        priority: meetingForm.priority,
        notes: meetingForm.minutesOfMeeting.trim(),
        status: meetingForm.status,
        actionType: selectedMeeting?.eventType || "Meeting",
      };

      const res = await API.put(`/followups/${editingMeetingId}`, payload);
      const updated = mapDocToMeeting(res.data);

      setMeetings((prev) => prev.map((m) => (m.id === editingMeetingId ? updated : m)));
      setSelectedMeeting(updated);
      setEditingMeetingId(null);
      setMeetingMode("view");
    } catch (err) {
      console.error(err);
      setMeetingFormError(err?.response?.data?.errors?.[0] || "Failed to update meeting");
    }
  };

  const submitFollowupEdit = async (e) => {
    e.preventDefault();
    setFormError("");

    const followupChecks = [
      required(followupForm.client, "Client"),
      required(followupForm.title, "Task"),
      required(followupForm.dueDate, "Due date"),
    ];
    const followupError = followupChecks.find(Boolean) || "";
    if (followupError) return setFormError(followupError);

    try {
      const payload = {
        kind: "followup",
        actionType: selectedFollowup?.actionType || "Follow Up Phone Call",
        title: followupForm.title.trim(),
        clientName: followupForm.client.trim(),
        stage: followupForm.stage,
        priority: followupForm.priority,
        dueDateTime: new Date(`${followupForm.dueDate}T09:00:00`).toISOString(),
        notes: selectedFollowup?.notes || "",
        status: selectedFollowup?.status || "pending",
      };

      const res = await API.put(`/followups/${editingFollowupId}`, payload);
      const updated = mapDocToFollowup(res.data);

      setFollowups((prev) => prev.map((f) => (f.id === editingFollowupId ? updated : f)));
      setSelectedFollowup(updated);
      setEditingFollowupId(null);
      setFollowupMode("list");
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
                className={cx("fuStageCard", activeStage === s.key && "active")}
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
            {meetingMode === "view" && selectedMeeting ? (
              <div className="fuDetailsWrap">
                <div className="fuDetailsHead">
                  <div className="fuAllTitle">Today's Meeting Details</div>
                  <div className="fuPanelActions">
                    <button className="fuBtn fuBtnPrimary" type="button" onClick={() => openMeetingEdit(selectedMeeting)}>Edit</button>
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
            ) : meetingMode === "edit" && selectedMeeting ? (
              <form className="fuFormScreen" onSubmit={submitMeetingEdit}>
                <div className="fuFormTitle">Edit Meeting</div>
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
                <FormErrorSlot message={meetingFormError} className="form-error-slot-global" />
                <div className="fuFormActions">
                  <button className="fuBtn fuBtnPrimary" type="submit">Save</button>
                  <button className="fuBtn fuBtnGhost" type="button" onClick={() => setMeetingMode("view")}>Cancel</button>
                </div>
              </form>
            ) : loading ? (
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
                            disabled={isCompletedStatus(m.status)}
                          >
                            {isCompletedStatus(m.status) ? "Completed" : "Done"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {filteredMeetings.length > 0 && (
                  <div className="fuPager">
                    <button className="fuMiniBtn" type="button" onClick={() => setMeetingPage((p) => Math.max(1, p - 1))} disabled={meetingPage <= 1}>Prev</button>
                    <span className="fuPagerText">Page {meetingPage} / {meetingTotalPages}</span>
                    <button className="fuMiniBtn" type="button" onClick={() => setMeetingPage((p) => Math.min(meetingTotalPages, p + 1))} disabled={meetingPage >= meetingTotalPages}>Next</button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="fuPanel fuPanelFixed">
          <header className="fuPanelHeader">
            <div>
              <h3>Active Follow-ups</h3>
              <div className="fuHint">
                {recordBucket === "existingClient" ? null : followupMode === "all" ? (
                  <>Showing: <span className="fuHintStrong">All stages</span></>
                ) : (
                  <>Stage: <span className="fuHintStrong">{activeStage}</span></>
                )}
              </div>
            </div>
          </header>

          <div className="fuPanelBody">
            {followupMode === "view" && selectedFollowup ? (
              <div className="fuDetailsWrap">
                <div className="fuDetailsHead">
                  <div className="fuAllTitle">Follow-up Details</div>
                  <div className="fuPanelActions">
                    <button className="fuBtn fuBtnPrimary" type="button" onClick={() => openFollowupEdit(selectedFollowup)}>Edit</button>
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
                  <div className="fuDetailCard"><div className="k">Status</div><div className="v">{selectedFollowup.status}</div></div>
                  <div className="fuDetailCard"><div className="k">Action Type</div><div className="v">{selectedFollowup.actionType || "-"}</div></div>
                  <div className="fuDetailCard"><div className="k">Reminder</div><div className="v">{selectedFollowup.reminderEnabled === "no" ? "No" : "Yes"}</div></div>
                  <div className="fuDetailCard"><div className="k">Agenda</div><div className="v">{selectedFollowup.agenda || "-"}</div></div>
                  <div className="fuDetailCard"><div className="k">Notes</div><div className="v">{selectedFollowup.notes || "-"}</div></div>
                </div>
              </div>
            ) : followupMode === "edit" ? (
              <form className="fuFormScreen" onSubmit={submitFollowupEdit}>
                <div className="fuFormTitle">Edit Follow-up</div>
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
                    Due Date*
                    <input className="fuField" type="date" value={followupForm.dueDate} onChange={(e) => setFollowupForm((p) => ({ ...p, dueDate: e.target.value }))} />
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
                <FormErrorSlot message={formError} className="form-error-slot-global" />
                <div className="fuFormActions">
                  <button className="fuBtn fuBtnPrimary" type="submit">Save</button>
                  <button className="fuBtn fuBtnGhost" type="button" onClick={() => setFollowupMode("list")}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <div className="fuList">
                  {loading ? (
                    <div className="fuEmptyBox">Loading follow-ups...</div>
                  ) : visibleFollowupsByStatus.length === 0 ? (
                    <div className="fuEmptyBox">
                      {statusFilter === "completed"
                        ? `No completed follow-ups in ${activeStage}.`
                        : statusFilter === "remaining"
                          ? `No remaining follow-ups in ${activeStage}.`
                          : `No follow-ups in ${activeStage}.`}
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
                            <span className="fuMetaChip">{f.status || "pending"}</span>
                          </div>
                        </div>
                        <div className="fuItemActions">
                          <button className="fuMiniBtn" type="button" onClick={() => openFollowupView(f)}>View</button>
                          <button
                            className={cx("fuMiniBtn", "done", isCompletedStatus(f.status) && "completed")}
                            type="button"
                            onClick={() => markDone(f.id)}
                            disabled={isCompletedStatus(f.status)}
                          >
                            {isCompletedStatus(f.status) ? "Completed" : "Done"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {filteredFollowupsByStatus.length > 0 && (
                  <div className="fuPager">
                    <button className="fuMiniBtn" type="button" onClick={() => setFollowupPage((p) => Math.max(1, p - 1))} disabled={followupPage <= 1}>Prev</button>
                    <span className="fuPagerText">Page {followupPage} / {followupTotalPages}</span>
                    <button className="fuMiniBtn" type="button" onClick={() => setFollowupPage((p) => Math.min(followupTotalPages, p + 1))} disabled={followupPage >= followupTotalPages}>Next</button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

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
                      <option key={s.key} value={s.key}>{s.key}</option>
                    ))}
                </select>
              </label>
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
    </div>
  );
}
