import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import LeadFormPage from "./LeadFormPage";
import "./styles/FollowupAddPage.css";

const STAGES = [
  { key: "P1", title: "P1 - Quote Sent" },
  { key: "P2", title: "P2 - Meeting Scheduled" },
  { key: "P3", title: "P3 - In Conversation" },
  { key: "P4", title: "P4 - No Service" },
  { key: "P5", title: "P5 - RNR" },
  { key: "P6", title: "P6 - No Response" },
  { key: "P7", title: "P7 - Won" },
];
const STAGE_KEYS = new Set(STAGES.map((s) => s.key));
const EVENT_TYPES = new Set(["Physical Meeting", "Online Meeting", "Follow Up Phone Call"]);
const PRIORITIES = new Set(["high", "medium", "low"]);

const EMPTY_FORM = {
  sourceType: "lead",
  assignedTo: "",
  reminderEnabled: "yes",
  eventType: "",
  date: "",
  time: "",
  stage: "",
  searchClient: "",
  purpose: "",
  taskDescription: "",
  priority: "medium",
  durationMinutes: "",
  agenda: "",
  currentLocation: "",
  currentExactLocation: "",
  meetingLocation: "",
  meetingLocationSearch: "",
  meetingExactLocation: "",
};

const EMPTY_CANCEL_MODAL = {
  open: false,
  id: "",
  kind: "followup",
  reason: "",
};

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

function toDateInputValue(rawDate) {
  if (!rawDate) return "";
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNowTimeHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseLatLng(raw = "") {
  const [latRaw, lngRaw] = String(raw).split(",").map((s) => s.trim());
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildOsmEmbedUrl(lat, lng) {
  const delta = 0.008;
  const left = lng - delta;
  const right = lng + delta;
  const top = lat + delta;
  const bottom = lat - delta;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function normalizeValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function extractAssignedUserId(row = {}) {
  return String(
    row?.assigned_to?._id ||
    row?.assigned_to ||
    row?.assignedTo?._id ||
    row?.assignedTo ||
    ""
  );
}

function userIdLabel(user, currentUserId) {
  const name = user?.name || "Unknown";
  const role = String(user?.role || "").trim();
  if (String(user?.id || "") === String(currentUserId || "")) {
    return role ? `${name} (Me • ${role})` : `${name} (Me)`;
  }
  return role ? `${name} (${role})` : name;
}

function inferSourceTypeFromDoc(doc) {
  if (doc?.dealId) return "deal";
  if (doc?.leadId) return "lead";
  if (doc?.clientId) return "deal";
  return "lead";
}

function mapDocToMeeting(doc) {
  return {
    id: doc._id,
    leadId: doc.leadId || "",
    dealId: doc.dealId || "",
    clientId: doc.clientId || "",
    stage: doc.stage || "P1",
    clientName: doc.clientName || "N/A",
    eventType: doc.actionType || "Meeting",
    time: formatTime(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    status: doc.status || "pending",
    priority: doc.priority || "medium",
    reminderEnabled: doc.reminderEnabled === false ? "no" : "yes",
    notes: doc.notes || "",
    durationMinutes: doc.durationMinutes || "",
    agenda: doc.agenda || "",
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
    sourceType: inferSourceTypeFromDoc(doc),
    currentLocation: doc.currentLocation || "",
    currentExactLocation: doc.currentExactLocation || "",
    meetingLocation: doc.meetingLocation || doc.address || "",
    meetingExactLocation: doc.meetingExactLocation || doc.exactLocation || "",
  };
}

function mapDocToFollowup(doc) {
  return {
    id: doc._id,
    leadId: doc.leadId || "",
    dealId: doc.dealId || "",
    clientId: doc.clientId || "",
    stage: doc.stage || "P1",
    title: doc.title || "",
    client: doc.clientName || "N/A",
    due: formatDate(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    priority: doc.priority || "medium",
    reminderEnabled: doc.reminderEnabled === false ? "no" : "yes",
    eventType: doc.actionType || "Follow Up Phone Call",
    time: formatTime(doc.dueDateTime),
    notes: doc.notes || "",
    status: doc.status || "pending",
    agenda: doc.agenda || "",
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
    sourceType: inferSourceTypeFromDoc(doc),
  };
}

function completionText(status = "") {
  const normalized = String(status).toLowerCase();
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  return "Not Completed";
}

function isMeetingEventType(eventType = "") {
  return String(eventType).toLowerCase().includes("meeting");
}

function isCompletedStatus(status = "") {
  return String(status).toLowerCase() === "completed";
}

function isCancelledStatus(status = "") {
  return String(status).toLowerCase() === "cancelled";
}

export default function FollowupsAddPage() {
  const [activeAction, setActiveAction] = useState("add");
  const [activeStage, setActiveStage] = useState("P1");
  const [formTarget, setFormTarget] = useState("followup");
  const [meetings, setMeetings] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [formData, setFormData] = useState({ ...EMPTY_FORM, stage: "P1" });
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [dealRows, setDealRows] = useState([]);
  const [leadRows, setLeadRows] = useState([]);

  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [scopeLabel, setScopeLabel] = useState("Sales Scope: My Records");
  const [currentRole, setCurrentRole] = useState("");
  const [teamOptions, setTeamOptions] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [recordScope, setRecordScope] = useState("mine");
  const [hasExistingClient, setHasExistingClient] = useState("yes");
  const [quickCreateType, setQuickCreateType] = useState("");
  const [cancelModal, setCancelModal] = useState(EMPTY_CANCEL_MODAL);
  const [cancelModalError, setCancelModalError] = useState("");
  const [savingCancel, setSavingCancel] = useState(false);

  const visibleFollowups = useMemo(
    () =>
      followups.filter((f) => {
        const stageMatch = (f.stage || "P1") === activeStage;
        let assigneeMatch = true;
        if (selectedEmployeeId) {
          const targetUserId = selectedEmployeeId === "__mine__" ? currentUserId : selectedEmployeeId;
          assigneeMatch = String(f.assignedToId || "") === String(targetUserId);
        } else if (recordScope === "mine") {
          assigneeMatch = String(f.assignedToId || "") === String(currentUserId);
        } else if (selectedTeamId) {
          if (selectedTeamId === "__mine__") {
            assigneeMatch = String(f.assignedToId || "") === String(currentUserId);
          } else {
            const team = teamOptions.find((t) => t.id === selectedTeamId);
            const users = team?.userIds || [];
            assigneeMatch = users.includes(String(f.assignedToId || ""));
          }
        }
        return stageMatch && assigneeMatch;
      }),
    [followups, activeStage, selectedEmployeeId, currentUserId, selectedTeamId, teamOptions, recordScope]
  );

  const visibleMeetings = useMemo(
    () =>
      meetings.filter((m) => {
        const stageMatch = (m.stage || "P1") === activeStage;
        let assigneeMatch = true;
        if (selectedEmployeeId) {
          const targetUserId = selectedEmployeeId === "__mine__" ? currentUserId : selectedEmployeeId;
          assigneeMatch = String(m.assignedToId || "") === String(targetUserId);
        } else if (recordScope === "mine") {
          assigneeMatch = String(m.assignedToId || "") === String(currentUserId);
        } else if (selectedTeamId) {
          if (selectedTeamId === "__mine__") {
            assigneeMatch = String(m.assignedToId || "") === String(currentUserId);
          } else {
            const team = teamOptions.find((t) => t.id === selectedTeamId);
            const users = team?.userIds || [];
            assigneeMatch = users.includes(String(m.assignedToId || ""));
          }
        }
        return stageMatch && assigneeMatch;
      }),
    [meetings, activeStage, selectedEmployeeId, currentUserId, selectedTeamId, teamOptions, recordScope]
  );

  const ownFollowups = useMemo(
    () => followups.filter((f) => String(f.assignedToId || "") === String(currentUserId || "")),
    [followups, currentUserId]
  );

  const ownMeetings = useMemo(
    () => meetings.filter((m) => String(m.assignedToId || "") === String(currentUserId || "")),
    [meetings, currentUserId]
  );

  const visibleEmployeeOptions = useMemo(() => {
    if (!selectedTeamId || selectedTeamId === "__mine__") return employeeOptions;
    const team = teamOptions.find((t) => t.id === selectedTeamId);
    const userIds = team?.userIds || [];
    return employeeOptions.filter((user) => userIds.includes(String(user.id)));
  }, [employeeOptions, selectedTeamId, teamOptions]);

  const assignableEmployeeOptions = useMemo(() => {
    if (currentRole === "admin" || currentRole === "manager") {
      return employeeOptions.filter((user) => user.role !== "admin" && user.role !== "manager");
    }
    return [];
  }, [currentRole, employeeOptions]);

  const defaultAssignableUserId = useMemo(
    () => String(assignableEmployeeOptions[0]?.id || ""),
    [assignableEmployeeOptions]
  );
  // Keep newly created records visible under "My Records" by default.
  const assigneeFallbackId = currentUserId || defaultAssignableUserId;

  const selectedSourceInfo = useMemo(() => {
    if (!selectedSourceId) return null;

    if (formData.sourceType === "lead") {
      const lead = leadRows.find((row) => String(row._id) === String(selectedSourceId));
      if (!lead) return null;
      return {
        title: lead.company_name || "Untitled Lead",
        phone: lead.primary_contact?.phone || "N/A",
        email: lead.primary_contact?.email || "N/A",
        extraOneLabel: "Industry",
        extraOneValue: lead.industry || "N/A",
      };
    }

    const deal = dealRows.find((row) => String(row._id) === String(selectedSourceId));
    if (!deal) return null;
    return {
      title: deal.company_name || "Untitled Deal",
      phone: deal.primary_contact?.phone || "N/A",
      email: deal.primary_contact?.email || "N/A",
      extraOneLabel: "Industry",
      extraOneValue: deal.industry || "N/A",
    };
  }, [dealRows, formData.sourceType, leadRows, selectedSourceId]);

  const suggestionRows = useMemo(() => {
    const query = normalizeValue(formData.searchClient);
    if (!query || selectedSourceId) return [];
    const mineOnly = String(currentUserId || "");

    if (formData.sourceType === "lead") {
      return leadRows
        .filter((lead) => {
          if (!mineOnly) return false;
          return extractAssignedUserId(lead) === mineOnly;
        })
        .filter((lead) => normalizeValue(lead.company_name).includes(query))
        .slice(0, 8)
        .map((lead) => ({
          id: String(lead._id),
          label: lead.company_name || "Untitled Lead",
          sourceType: "lead",
          stage: "P1",
          leadId: String(lead._id),
        }));
    }

    return dealRows
      .filter((deal) => {
        if (!mineOnly) return false;
        return extractAssignedUserId(deal) === mineOnly;
      })
      .filter((deal) => normalizeValue(deal.company_name).includes(query))
      .slice(0, 8)
      .map((deal) => ({
        id: String(deal._id),
        label: deal.company_name || "Untitled Deal",
        sourceType: formData.sourceType,
        stage: deal.stage || "P1",
        dealId: String(deal._id),
        clientId: String(deal.clientId || deal.client_id || ""),
        leadId: deal.lead_id ? String(deal.lead_id) : "",
      }));
  }, [currentUserId, dealRows, formData.searchClient, formData.sourceType, leadRows, selectedSourceId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [mRes, fRes, dRes, lRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting" } }),
        API.get("/followups", { params: { kind: "followup" } }),
        API.get("/deals"),
        API.get("/leads"),
      ]);
      setMeetings((mRes.data || []).map(mapDocToMeeting));
      setFollowups((fRes.data || []).map(mapDocToFollowup));
      setDealRows(dRes.data || []);
      setLeadRows(lRes.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load data");
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

  useEffect(() => {
    if (currentRole !== "admin" && currentRole !== "manager") return;
    setFormData((prev) => {
      const existing = String(prev.assignedTo || "");
      if (existing) return prev;
      return { ...prev, assignedTo: assigneeFallbackId };
    });
  }, [currentRole, assigneeFallbackId]);

  const resetForm = () => {
    setFormData({
      ...EMPTY_FORM,
      assignedTo: assigneeFallbackId || "",
    });
    setFormError("");
    setEditingRecord(null);
    setSelectedSourceId("");
    setHasExistingClient("yes");
    setClientSuggestions([]);
    setLocationSuggestions([]);
  };

  const openQuickCreateModal = (type) => {
    setQuickCreateType(type);
  };

  const closeQuickCreateModal = () => {
    setQuickCreateType("");
  };

  const handleQuickCreateSaved = async (data) => {
    const createdLead = data?.lead || data || {};
    const createdDeal = data?.deal || null;
    const nextType = quickCreateType === "deal" ? "deal" : "lead";
    const nextId = String(
      quickCreateType === "deal"
        ? createdDeal?._id || createdLead?._id || ""
        : createdLead?._id || data?._id || ""
    );
    const nextLabel = createdLead?.company_name || createdDeal?.company_name || "";
    const nextStage = createdDeal?.stage || createdLead?.stage || "P1";

    await loadData();

    setHasExistingClient("yes");
    setSelectedSourceId(nextId);
    setFormData((prev) => ({
      ...prev,
      sourceType: nextType,
      searchClient: nextLabel,
      stage: nextStage,
    }));
    closeQuickCreateModal();
  };

  const applyClientSelection = (item) => {
    const id = String(item?.id || "");
    setSelectedSourceId(id);
    setFormData((p) => ({
      ...p,
      searchClient: item?.label || "",
      stage: item?.stage || "P1",
    }));
    setClientSuggestions([]);
  };

  useEffect(() => {
    setClientSuggestions(suggestionRows);
  }, [suggestionRows]);

  useEffect(() => {
    if (formData.eventType !== "Physical Meeting") {
      setLocationSuggestions([]);
      return;
    }

    const query = formData.meetingLocationSearch.trim();
    if (query.length < 2) {
      setLocationSuggestions([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoadingLocationSuggestions(true);
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { "Accept-Language": "en" } });
        const data = await res.json();
        setLocationSuggestions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingLocationSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [formData.meetingLocationSearch, formData.eventType]);

  const fillCurrentLocation = () => {
    if (!navigator.geolocation) {
      setFormError("Geolocation is not supported in this browser");
      return;
    }

    setFormError("");
    setLocatingCurrent(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude).toFixed(6);
        const lng = Number(position.coords.longitude).toFixed(6);
        let label = `${lat}, ${lng}`;

        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
          const res = await fetch(url, { headers: { "Accept-Language": "en" } });
          const data = await res.json();
          label = data?.display_name || label;
        } catch (err) {
          console.error(err);
        } finally {
          setFormData((p) => ({
            ...p,
            currentLocation: label,
            currentExactLocation: `${lat}, ${lng}`,
          }));
          setLocatingCurrent(false);
        }
      },
      () => {
        setLocatingCurrent(false);
        setFormError("Unable to fetch current location");
      }
    );
  };

  const validateForm = () => {
    const eventType = String(formData.eventType || "").trim();
    const sourceType = String(formData.sourceType || "").trim();
    const dateValue = String(formData.date || "").trim();
    const timeValue = String(formData.time || "").trim();
    const titleValue = String((formData.taskDescription || formData.purpose || "")).trim();
    const agendaValue = String(formData.agenda || "").trim();
    const stageValue = String(formData.stage || "").trim();
    const priorityValue = String(formData.priority || "").trim().toLowerCase();

    if (!sourceType || !(sourceType === "lead" || sourceType === "deal")) return "Follow-up For is required";
    if (!eventType) return "Event type is required";
    if (!EVENT_TYPES.has(eventType)) return "Invalid event type";
    if (!dateValue) return "Date is required";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return "Date format is invalid";
    if (!timeValue) return "Time is required";
    if (!/^\d{2}:\d{2}$/.test(timeValue)) return "Time format is invalid";

    const dueAt = new Date(`${dateValue}T${timeValue}:00`);
    if (Number.isNaN(dueAt.getTime())) return "Invalid date/time selected";

    if (hasExistingClient === "yes") {
      if (!String(formData.searchClient || "").trim()) return "Selection is required";
      if (!selectedSourceId) return "Select an item from suggestions";
      if (sourceType === "lead" && !leadRows.some((row) => String(row._id) === String(selectedSourceId))) {
        return "Selected lead is invalid";
      }
      if (sourceType === "deal" && !dealRows.some((row) => String(row._id) === String(selectedSourceId))) {
        return "Selected deal is invalid";
      }
    } else if (!selectedSourceId) {
      return "Create a new lead/deal and select it before submitting";
    }

    if (!titleValue) return "Purpose/Task description is required";
    if (titleValue.length < 3) return "Purpose/Task description must be at least 3 characters";

    if (!stageValue) return "Stage is required";
    if (!STAGE_KEYS.has(stageValue)) return "Invalid stage selected";
    if (!agendaValue) return "Agenda of meeting is required";
    if (agendaValue.length < 3) return "Agenda of meeting must be at least 3 characters";
    if (!PRIORITIES.has(priorityValue)) return "Invalid priority selected";

    if (formData.durationMinutes !== "" && formData.durationMinutes !== null && formData.durationMinutes !== undefined) {
      const duration = Number(formData.durationMinutes);
      if (!Number.isFinite(duration) || duration < 1) return "Duration must be a positive number";
    }

    if (
      eventType === "Physical Meeting" &&
      !String(formData.currentLocation || "").trim() &&
      !String(formData.meetingExactLocation || "").trim()
    ) {
      return "Provide either current location or meeting location";
    }
    return "";
  };

  const openDetails = (type, item) => {
    setSelectedRecord({ type, item });
    setActiveAction("view");
  };

  const openEditFromDetails = () => {
    if (!selectedRecord) return;
    const { type, item } = selectedRecord;
    const existingName = type === "meeting" ? item.clientName : item.client;
    const matchedDeal = (dealRows || []).find((d) => normalizeValue(d.company_name) === normalizeValue(existingName));
    const inferredSourceType = item.sourceType || (matchedDeal || item.clientId ? "deal" : "lead");
    const matchedSourceId =
      inferredSourceType === "lead"
        ? String(item.leadId || "")
        : inferredSourceType === "deal"
          ? String(item.dealId || matchedDeal?._id || "")
          : "";
    const matchedStage = item.stage || matchedDeal?.stage || "P1";

    setFormTarget(type);
    setEditingRecord({ type, id: item.id });
    if (type === "meeting") {
      setFormData({
        ...EMPTY_FORM,
        sourceType: inferredSourceType,
        eventType: item.eventType || "",
        time: item.time || "",
        date: toDateInputValue(item.dueDateTime),
        searchClient: item.clientName || "",
        purpose: item.notes || "",
        taskDescription: item.notes || "",
        priority: item.priority || "medium",
        assignedTo: item.assignedToId || assigneeFallbackId || "",
        reminderEnabled: item.reminderEnabled || "yes",
        durationMinutes: item.durationMinutes || "",
        agenda: item.agenda || "",
        currentLocation: item.currentLocation || "",
        currentExactLocation: item.currentExactLocation || "",
        meetingLocation: item.meetingLocation || "",
        meetingLocationSearch: item.meetingLocation || "",
        meetingExactLocation: item.meetingExactLocation || "",
        stage: matchedStage,
      });
    } else {
      setFormData({
        ...EMPTY_FORM,
        sourceType: inferredSourceType,
        eventType: item.eventType || "Follow Up Phone Call",
        time: item.time || "",
        date: toDateInputValue(item.dueDateTime),
        searchClient: item.client || "",
        purpose: item.title || "",
        taskDescription: item.title || "",
        priority: item.priority || "medium",
        assignedTo: item.assignedToId || assigneeFallbackId || "",
        reminderEnabled: item.reminderEnabled || "yes",
        agenda: item.agenda || "",
        stage: matchedStage,
      });
    }
    setSelectedSourceId(matchedSourceId);
    setHasExistingClient("yes");
    setClientSuggestions([]);
    setFormError("");
    setActiveAction("add");
  };

  const submitForm = async (e) => {
    e.preventDefault();
    const v = validateForm();
    if (v) return setFormError(v);
    setFormError("");

    try {
      const resolvedTarget = editingRecord?.type || (isMeetingEventType(formData.eventType) ? "meeting" : "followup");
      const dueAt = new Date(`${formData.date}T${formData.time}:00`);
      if (Number.isNaN(dueAt.getTime())) {
        return setFormError("Invalid date/time selected");
      }
      const dueDateTime = dueAt.toISOString();
      const resolvedStage =
        resolvedTarget === "meeting" && formData.sourceType === "lead"
          ? "P2"
          : (formData.stage || activeStage);
      const selectedDealRow =
        formData.sourceType === "existingClient" || formData.sourceType === "deal"
          ? (dealRows || []).find((row) => String(row._id) === String(selectedSourceId))
          : null;
      const payload = {
        kind: resolvedTarget === "meeting" ? "meeting" : "followup",
        actionType: formData.eventType,
        title: (formData.taskDescription || formData.purpose).trim(),
        clientName: formData.searchClient.trim(),
        stage: resolvedStage,
        leadId: formData.sourceType === "lead" ? selectedSourceId : undefined,
        dealId: formData.sourceType === "deal" ? selectedSourceId : undefined,
        clientId:
          formData.sourceType === "existingClient"
            ? (selectedDealRow?.clientId || selectedDealRow?.client_id || selectedSourceId)
            : undefined,
        dueDateTime,
        assignedTo: formData.assignedTo || assigneeFallbackId || undefined,
        reminderEnabled: formData.reminderEnabled !== "no",
        // New records should start as pending; completion is an explicit action.
        status: editingRecord ? undefined : "pending",
        priority: formData.priority || "medium",
        notes: formData.purpose || formData.taskDescription,
        durationMinutes: formData.durationMinutes || undefined,
        agenda: formData.agenda || "",
        currentLocation: formData.currentLocation.trim() || "",
        currentExactLocation: formData.currentExactLocation || "",
        meetingLocation: formData.meetingLocation.trim() || formData.meetingLocationSearch.trim() || "",
        meetingExactLocation: formData.meetingExactLocation || "",
        address: formData.meetingLocation.trim() || formData.meetingLocationSearch.trim() || "",
        exactLocation: formData.meetingExactLocation || "",
      };

      let res;
      if (editingRecord) {
        res = await API.put(`/followups/${editingRecord.id}`, payload);
      } else {
        res = await API.post("/followups", payload);
      }

      const mapped = resolvedTarget === "meeting" ? mapDocToMeeting(res.data) : mapDocToFollowup(res.data);
      if (resolvedTarget === "meeting") {
        setMeetings((prev) =>
          editingRecord?.type === "meeting" ? prev.map((m) => (m.id === editingRecord.id ? mapped : m)) : [...prev, mapped]
        );
        setActiveAction("meeting");
      } else {
        setFollowups((prev) =>
          editingRecord?.type === "followup" ? prev.map((f) => (f.id === editingRecord.id ? mapped : f)) : [...prev, mapped]
        );
        setActiveAction("followup");
      }
      resetForm();
    } catch (err) {
      console.error(err);
      setFormError(err?.response?.data?.errors?.[0] || "Failed to save");
    }
  };

  const renderForm = () => (
    (() => {
      const selectedLatLng = parseLatLng(formData.meetingExactLocation);
      const selectedAt = formData.date && formData.time ? new Date(`${formData.date}T${formData.time}:00`) : null;
      const isPastSelected = selectedAt && !Number.isNaN(selectedAt.getTime()) && selectedAt < new Date();
      return (
        <form className="fuaForm" onSubmit={submitForm}>
          {formError && <div className="fuaEmpty">{formError}</div>}
          <div className="fuaGrid">
        <label className="full">
          Follow-up For*
          <select
            value={formData.sourceType}
            onChange={(e) => {
              const nextSourceType = e.target.value;
              setSelectedSourceId("");
              setClientSuggestions([]);
              setFormData((p) => ({
                ...EMPTY_FORM,
                sourceType: nextSourceType,
                assignedTo: p.assignedTo || assigneeFallbackId || "",
                eventType: p.eventType,
                date: p.date,
                time: p.time,
                priority: p.priority,
              }));
            }}
          >
            <option value="lead">Lead</option>
            <option value="deal">Deal</option>
          </select>
        </label>

        <label>
          Event Type*
          <select value={formData.eventType} onChange={(e) => setFormData((p) => ({ ...p, eventType: e.target.value }))}>
            <option value="">--Please Select--</option>
            <option value="Physical Meeting">Physical Meeting</option>
            <option value="Online Meeting">Online Meeting</option>
            <option value="Follow Up Phone Call">Follow Up Phone Call</option>
          </select>
        </label>

        <label>
          Time*
          <input type="time" value={formData.time} onChange={(e) => setFormData((p) => ({ ...p, time: e.target.value }))} />
        </label>

        <label>
          Date*
          <input type="date" value={formData.date} onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))} />
        </label>

        <div className="full fuaInlineField">
          <div className="fuaInlineFieldLabel">Reminder</div>
          <div className="fuaInlineFieldContent">
            <div className="fuaBinaryRow">
              <label className="fuaBinaryOption">
                <input
                  type="radio"
                  name="reminderEnabled"
                  checked={formData.reminderEnabled !== "no"}
                  onChange={() => setFormData((p) => ({ ...p, reminderEnabled: "yes" }))}
                />
                <span>Yes</span>
              </label>
              <label className="fuaBinaryOption">
                <input
                  type="radio"
                  name="reminderEnabled"
                  checked={formData.reminderEnabled === "no"}
                  onChange={() => setFormData((p) => ({ ...p, reminderEnabled: "no" }))}
                />
                <span>No</span>
              </label>
            </div>
          </div>
        </div>

        <div className="full fuaInlineField">
          <div className="fuaInlineFieldLabel">Client Type*</div>
          <div className="fuaInlineFieldContent">
            <div className="fuaBinaryRow">
              <label className="fuaBinaryOption">
                <input
                  type="radio"
                  name="clientType"
                  checked={hasExistingClient === "yes"}
                  onChange={() => {
                    setHasExistingClient("yes");
                    setSelectedSourceId("");
                  setClientSuggestions([]);
                  setFormData((p) => ({
                    ...EMPTY_FORM,
                    sourceType: p.sourceType === "deal" ? "deal" : "lead",
                    assignedTo: p.assignedTo || assigneeFallbackId || "",
                    eventType: p.eventType,
                    date: p.date,
                    time: p.time,
                    priority: p.priority,
                    }));
                  }}
                />
                <span>Existing Client/Lead</span>
              </label>
              <label className="fuaBinaryOption">
                <input
                  type="radio"
                  name="clientType"
                  checked={hasExistingClient === "no"}
                  onChange={() => setHasExistingClient("no")}
                />
                <span>Add New Client/Lead</span>
              </label>
              {hasExistingClient === "no" && (
                <div className="fuaInlineCreateActions">
                  <button className="fuaBtn ghost" type="button" onClick={() => openQuickCreateModal("lead")}>
                    Add New Lead
                  </button>
                  <button className="fuaBtn ghost" type="button" onClick={() => openQuickCreateModal("deal")}>
                    Add New Deal
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {hasExistingClient === "yes" ? (
          <>
        <label>
          {formData.sourceType === "lead" ? "Search Existing Lead*" : "Search Existing Client*"}
          <div className="fuaSuggestField">
            <input
              type="text"
              placeholder={formData.sourceType === "lead" ? "Type Lead Name" : "Type Client Name"}
              value={formData.searchClient}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedSourceId("");
                setFormData((p) => ({ ...p, searchClient: next, stage: "" }));
              }}
            />
            {!selectedSourceId && clientSuggestions.length > 0 && (
              <div className="fuaSuggestList">
                {clientSuggestions.map((c) => (
                  <button key={String(c.id)} type="button" className="fuaSuggestItem" onClick={() => applyClientSelection(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        {selectedSourceInfo && (
          <div className="fuaSelectedInfo full">
            <div className="fuaSelectedGrid">
              <div className="fuaSelectedItem">
                <div className="key">{formData.sourceType === "lead" ? "Lead Name" : "Client Name"}</div>
                <div className="val">{selectedSourceInfo.title}</div>
              </div>
              <div className="fuaSelectedItem">
                <div className="key">{formData.sourceType === "lead" ? "Lead Mobile" : "Client Mobile"}</div>
                <div className="val">{selectedSourceInfo.phone}</div>
              </div>
              <div className="fuaSelectedItem">
                <div className="key">{formData.sourceType === "lead" ? "Lead Email" : "Client Email"}</div>
                <div className="val">{selectedSourceInfo.email}</div>
              </div>
              <div className="fuaSelectedItem">
                <div className="key">{selectedSourceInfo.extraOneLabel}</div>
                <div className="val">{selectedSourceInfo.extraOneValue}</div>
              </div>
            </div>
          </div>
        )}
          </>
        ) : null}

        <label className="full">
          Purpose / Task Description*
          <input type="text" placeholder="Purpose of meeting / task" value={formData.taskDescription || formData.purpose} onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value, taskDescription: e.target.value }))} />
        </label>

        <label className="full">
          {isPastSelected ? "MOM*" : "Agenda of Meeting*"}
          <input
            type="text"
            placeholder={isPastSelected ? "Enter MOM" : "Enter agenda of meeting"}
            value={formData.agenda}
            onChange={(e) => setFormData((p) => ({ ...p, agenda: e.target.value }))}
          />
        </label>

        {isPastSelected && (
          <label>
            Status
            <input type="text" value="Completed" readOnly />
          </label>
        )}

        {formData.sourceType !== "existingClient" && (
          <label>
            Stage
            <input type="text" value={formData.stage || "No stage found"} readOnly />
          </label>
        )}

        <label>
          Priority
          <select value={formData.priority} onChange={(e) => setFormData((p) => ({ ...p, priority: e.target.value }))}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        {formData.eventType === "Online Meeting" && (
          <>
            <label>
              Duration of Meeting (minutes)
              <input type="number" min="1" placeholder="30" value={formData.durationMinutes} onChange={(e) => setFormData((p) => ({ ...p, durationMinutes: e.target.value }))} />
            </label>
          </>
        )}

        {formData.eventType === "Physical Meeting" && (
          <>
            <div className="fuaHint full">Provide either Current Location or Meeting Location.</div>
            <label className="full">
              Current Location
              <div className="fuaSuggestField">
                <input
                  type="text"
                  placeholder="Use current location or enter manually"
                  value={formData.currentLocation}
                  onChange={(e) => setFormData((p) => ({ ...p, currentLocation: e.target.value }))}
                />
                <button className="fuaBtn ghost" type="button" onClick={fillCurrentLocation} disabled={locatingCurrent}>
                  {locatingCurrent ? "Locating..." : "Use Current Location"}
                </button>
              </div>
            </label>
            {/* <label className="full">
              Meeting Location*
              <input
                type="text"
                placeholder="Enter meeting location manually"
                value={formData.meetingLocation}
                onChange={(e) => setFormData((p) => ({ ...p, meetingLocation: e.target.value }))}
              />
            </label> */}
            <label className="full">
              Meeting Location
              <div className="fuaSuggestField">
                <input
                  type="text"
                  placeholder="Type area, landmark, city..."
                  value={formData.meetingLocationSearch}
                  onChange={(e) => setFormData((p) => ({ ...p, meetingLocationSearch: e.target.value, meetingExactLocation: "" }))}
                />
                {loadingLocationSuggestions && <span className="fuaHint">Searching places...</span>}
                {locationSuggestions.length > 0 && (
                  <div className="fuaSuggestList">
                    {locationSuggestions.map((loc) => (
                      <button
                        key={`${loc.place_id}-${loc.lat}-${loc.lon}`}
                        className="fuaSuggestItem"
                        type="button"
                        onClick={() => {
                          setFormData((p) => ({
                            ...p,
                            meetingLocationSearch: loc.display_name || p.meetingLocationSearch,
                            meetingLocation: p.meetingLocation || loc.display_name || "",
                            meetingExactLocation: `${Number(loc.lat).toFixed(6)}, ${Number(loc.lon).toFixed(6)}`,
                          }));
                          setLocationSuggestions([]);
                        }}
                      >
                        {loc.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            {selectedLatLng && (
              <div className="fuaMapWrap full">
                <iframe
                  title="Selected location map"
                  className="fuaMap"
                  loading="lazy"
                  src={buildOsmEmbedUrl(selectedLatLng.lat, selectedLatLng.lng)}
                />
              </div>
            )}
          </>
        )}
          </div>

          <div className="fuaActions">
            <button className="fuaBtn primary" type="submit">{editingRecord ? "Update" : "Submit"}</button>
            <button className="fuaBtn danger" type="button" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      );
    })()
  );

  const renderQuickCreateModal = () => {
    if (!quickCreateType) return null;

    return (
      <div className="fuaModalOverlay" onClick={closeQuickCreateModal}>
        <div className="fuaModal" onClick={(e) => e.stopPropagation()}>
          <div className="fuaModalHead">
            <div className="fuaModalTitleWrap">
              <h3>{quickCreateType === "lead" ? "Add New Lead" : "Add New Deal"}</h3>
            </div>
            <div className="fuaModalHeaderActions">
              <button className="fuaBtn ghost" type="button" onClick={closeQuickCreateModal}>
                Back
              </button>
            </div>
          </div>
          <div className="fuaModalScroll">
            <div className="fuaEmbeddedFormWrap">
              <LeadFormPage
                embedded
                forcedView={quickCreateType}
                onCancel={closeQuickCreateModal}
                onSaved={handleQuickCreateSaved}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFollowups = (items) => (
    <div className="fuaList">
      {items.map((f) => (
        <div key={f.id} className="fuaCard">
          <div className={cx("dot", f.priority)} />
          <div className="main">
            <div className="title">{f.client} - {f.title}</div>
            <div className="meta">
              <span>Due: {f.due}</span>
              <span>{f.stage}</span>
              <span className={cx("fuaStatus", String(f.status).toLowerCase() === "completed" ? "completed" : "pending")}>{completionText(f.status)}</span>
            </div>
          </div>
          <div className="actions">
            <button className="fuaBtn ghost" type="button" onClick={() => openDetails("followup", f)}>View</button>
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="fuaEmpty">No follow-ups.</div>}
    </div>
  );

  const renderMeetings = (items = meetings) => (
    <div className="fuaList">
      {items.map((m) => (
        <div key={m.id} className="fuaCard">
          <div className={cx("dot", m.priority)} />
          <div className="main">
            <div className="title">{m.clientName} - {m.eventType}</div>
            <div className="meta">
              <span>Time: {m.time}</span>
              <span>{m.priority || "medium"}</span>
              <span className={cx("fuaStatus", String(m.status).toLowerCase() === "completed" ? "completed" : "pending")}>{completionText(m.status)}</span>
            </div>
          </div>
          <div className="actions">
            <button className="fuaBtn ghost" type="button" onClick={() => openDetails("meeting", m)}>View</button>
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="fuaEmpty">No meetings.</div>}
    </div>
  );

  const openCancelModal = () => {
    if (!selectedRecord?.item?.id) return;
    if (isCompletedStatus(selectedRecord.item.status) || isCancelledStatus(selectedRecord.item.status)) return;
    setCancelModal({
      open: true,
      id: String(selectedRecord.item.id),
      kind: selectedRecord.type === "meeting" ? "meeting" : "followup",
      reason: "",
    });
    setCancelModalError("");
  };

  const renderCancelModal = () => {
    if (!cancelModal.open) return null;
    return (
      <div className="fuaModalOverlay" onClick={closeCancelModal}>
        <form className="fuaModal" onSubmit={submitCancel} onClick={(e) => e.stopPropagation()}>
          <div className="fuaModalHead">
            <div className="fuaModalTitleWrap">
              <h3>Cancel {cancelModal.kind === "meeting" ? "Meeting" : "Follow-up"}</h3>
            </div>
          </div>
          <div className="fuaModalScroll">
            {cancelModalError && <div className="fuaEmpty">{cancelModalError}</div>}
            <div className="fuaGrid">
              <label className="full">
                Reason for Cancellation*
                <textarea
                  rows={4}
                  value={cancelModal.reason}
                  onChange={(e) => setCancelModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </label>
            </div>
            <div className="fuaActions">
              <button className="fuaBtn primary" type="submit" disabled={savingCancel}>
                {savingCancel ? "Saving..." : "Save Cancellation"}
              </button>
              <button className="fuaBtn ghost" type="button" onClick={closeCancelModal} disabled={savingCancel}>
                Back
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  };

  const closeCancelModal = () => {
    if (savingCancel) return;
    setCancelModal(EMPTY_CANCEL_MODAL);
    setCancelModalError("");
  };

  const submitCancel = async (e) => {
    e.preventDefault();
    setCancelModalError("");
    const recordId = String(cancelModal.id || "");
    const trimmedReason = String(cancelModal.reason || "").trim();
    if (!recordId) return setCancelModalError("Record id is missing");
    if (!trimmedReason) return setCancelModalError("Cancellation reason is required");
    try {
      setSavingCancel(true);
      const res = await API.patch(`/followups/${recordId}/status`, {
        status: "cancelled",
        cancelReason: trimmedReason,
        notes: trimmedReason,
      });

      if (cancelModal.kind === "meeting") {
        const updated = mapDocToMeeting(res.data);
        setMeetings((prev) => prev.map((m) => (String(m.id) === String(updated.id) ? updated : m)));
        setSelectedRecord({ type: "meeting", item: updated });
      } else {
        const updated = mapDocToFollowup(res.data);
        setFollowups((prev) => prev.map((f) => (String(f.id) === String(updated.id) ? updated : f)));
        setSelectedRecord({ type: "followup", item: updated });
      }
      setCancelModal(EMPTY_CANCEL_MODAL);
    } catch (err) {
      console.error(err);
      setCancelModalError(err?.response?.data?.message || "Failed to cancel record");
    } finally {
      setSavingCancel(false);
    }
  };

  const renderDetails = () => {
    if (!selectedRecord) return <div className="fuaEmpty">No details found.</div>;
    const { type, item } = selectedRecord;
    const rows = type === "meeting"
      ? [
          ["Client", item.clientName],
          ["Event Type", item.eventType],
          ["Time", item.time],
          ["Status", item.status],
          ["Priority", item.priority || "N/A"],
          ["Notes", item.notes || "N/A"],
          ["Duration", item.durationMinutes || "N/A"],
          ["Agenda", item.agenda || "N/A"],
          ["Current Location", item.currentLocation || "N/A"],
          ["Meeting Location", item.meetingLocation || "N/A"],
          ["Meeting Coordinates", item.meetingExactLocation || "N/A"],
        ]
      : [
          ["Client", item.client],
          ["Task", item.title],
          ["Stage", item.stage],
          ["Due", item.due],
          ["Status", completionText(item.status)],
          ["Priority", item.priority],
          ["Event Type", item.eventType || "N/A"],
          ["Time", item.time || "N/A"],
          ["Notes", item.notes || "N/A"],
          ["Agenda", item.agenda || "N/A"],
        ];

    return (
      <div className="fuaDetails">
        <div className="fuaDetailsHead">
          <h3>{type === "meeting" ? "Meeting Details" : "Followup Details"}</h3>
          <div className="fuaActions">
            <button className="fuaBtn primary" type="button" onClick={openEditFromDetails}>Edit</button>
            {!isCompletedStatus(item?.status) && !isCancelledStatus(item?.status) && (
              <button className="fuaBtn danger" type="button" onClick={openCancelModal}>Cancel</button>
            )}
            <button className="fuaBtn ghost" type="button" onClick={() => setActiveAction(type)}>Back</button>
          </div>
        </div>
        <div className="fuaDetailsGrid">
          {rows.map(([k, v]) => (
            <div key={k} className="fuaDetailItem">
              <div className="key">{k}</div>
              <div className="val">{v || "N/A"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fuaPage">
      <div className="fuaToolbar">
        <button className={cx("fuaToolbarBtn", activeAction === "add" && "active")} type="button" onClick={() => { setFormTarget("followup"); setActiveAction("add"); }}>
          <span className="fuaToolbarIcon">✚</span>
          <span>Add</span>
        </button>
        <button className={cx("fuaToolbarBtn", activeAction === "followup" && "active")} type="button" onClick={() => { setFormTarget("followup"); setActiveAction("followup"); }}>
          <span className="fuaToolbarIcon">⏰</span>
          <span>Followup</span>
        </button>
        <button className={cx("fuaToolbarBtn", activeAction === "meeting" && "active")} type="button" onClick={() => { setFormTarget("meeting"); setActiveAction("meeting"); }}>
          <span className="fuaToolbarIcon">📅</span>
          <span>Meeting</span>
        </button>
        <button className={cx("fuaToolbarBtn", activeAction === "filter" && "active")} type="button" onClick={() => setActiveAction("filter")}>
          <span className="fuaToolbarIcon">🧊</span>
          <span>Filter</span>
        </button>
      </div>

      <section className="fuaPanel">
        {error && <div className="fuaEmpty">{error}</div>}
        {loading && <div className="fuaEmpty">Loading...</div>}
        {!loading && activeAction === "add" && renderForm()}
        {!loading && activeAction === "followup" && renderFollowups(ownFollowups)}
        {!loading && activeAction === "meeting" && renderMeetings(ownMeetings)}
        {!loading && activeAction === "view" && renderDetails()}
        {!loading && activeAction === "filter" && (
          <>
            {(currentRole === "admin" || currentRole === "manager") && (
              <div className="fuaFilterBar">
                <select
                  className="fuaFilterSelect"
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
                  className="fuaFilterSelect"
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
                  className="fuaFilterSelect"
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
            <div className="fuaStages">
              {STAGES.map((s) => (
                <button key={s.key} className={cx("fuaStageBtn", activeStage === s.key && "active")} type="button" onClick={() => setActiveStage(s.key)}>
                  {s.title}
                </button>
              ))}
            </div>
            <div className="fuaSectionBlock">
              <h3 className="fuaSectionTitle">Meetings</h3>
              {renderMeetings(visibleMeetings)}
            </div>
            <div className="fuaSectionBlock">
              <h3 className="fuaSectionTitle">Follow-ups</h3>
              {renderFollowups(visibleFollowups)}
            </div>
          </>
        )}
      </section>
      {renderQuickCreateModal()}
      {renderCancelModal()}
    </div>
  );
}
