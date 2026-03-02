import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
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

function mapDocToMeeting(doc) {
  const dueDateTime = doc.dueDateTime || doc.startTime || doc.meetingDate;
  const followupId = doc.sourceFollowupId || doc.Id || doc.followupId || doc._id;
  return {
    id: String(followupId),
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
    assignedToId: String(doc.assignedTo?._id || doc.assignedTo || ""),
    assignedToName: doc.assignedTo?.name || "",
    address: doc.address || doc.Address || "",
    exactLocation: doc.exactLocation || [doc.latitude, doc.longitude].filter(Boolean).join(", "),
  };
}

function mapDocToFollowup(doc) {
  return {
    id: doc._id,
    client: doc.clientName || "N/A",
    title: doc.title || "",
    stage: doc.stage || "P1",
    due: formatDate(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    priority: doc.priority || "medium",
    status: doc.status || "pending",
    actionType: doc.actionType || "Follow Up Phone Call",
    notes: doc.notes || "",
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

function isPhysicalMeetingEvent(eventType = "") {
  return String(eventType).toLowerCase().includes("physical");
}

export default function Followups() {
  const [activeStage, setActiveStage] = useState("P1");
  const [followupMode, setFollowupMode] = useState("list");
  const [followups, setFollowups] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [meetingMode, setMeetingMode] = useState("list");
  const [statusFilter, setStatusFilter] = useState("remaining");
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
  const [scopeLabel, setScopeLabel] = useState("My Records");
  const [currentRole, setCurrentRole] = useState("");
  const [teamOptions, setTeamOptions] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const date = getLocalDateISO();
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const [meetingRes, followupMeetingRes, followupRes] = await Promise.all([
        API.get("/followups/today/meetings", { params: { date, tzOffsetMinutes } }),
        API.get("/followups", { params: { kind: "meeting", today: "true", date, tzOffsetMinutes } }),
        API.get("/followups", { params: { kind: "followup", today: "true", date, tzOffsetMinutes } }),
      ]);

      const assignmentById = new Map(
        [...(followupMeetingRes.data || []), ...(followupRes.data || [])]
          .filter((d) => d?._id)
          .map((d) => [
            String(d._id),
            {
              assignedToId: String(d.assignedTo?._id || d.assignedTo || ""),
              assignedToName: d.assignedTo?.name || "",
            },
          ])
      );

      const stageById = new Map(
        [...(followupMeetingRes.data || []), ...(followupRes.data || [])]
          .filter((d) => d?._id)
          .map((d) => [String(d._id), d.stage || ""])
      );

      const meetingLikeFollowups = (followupRes.data || []).filter((d) => isMeetingLikeAction(d.actionType));

      const mergedMeetings = [...(meetingRes.data || []), ...(followupMeetingRes.data || []), ...meetingLikeFollowups]
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
    if (!(currentRole === "admin" || currentRole === "manager")) return;
    (async () => {
      try {
        const res = await API.get("/followups/filter-options");
        setTeamOptions(res.data?.teams || []);
        setEmployeeOptions(res.data?.employees || []);
      } catch (err) {
        console.error(err);
      }
    })();
  }, [currentRole]);

  const stageCounts = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
    followups.forEach((f) => {
      map[f.stage] = (map[f.stage] || 0) + 1;
    });
    return map;
  }, [followups]);

  const visibleFollowups = useMemo(
    () => followups.filter((f) => f.stage === activeStage),
    [followups, activeStage]
  );

  const filteredMeetings = useMemo(
    () => meetings.filter((m) => {
      const statusMatch = statusFilter === "completed" ? isCompletedStatus(m.status) : !isCompletedStatus(m.status);
      const stageMatch = m.stage === activeStage;
      let assigneeMatch = true;
      if (selectedEmployeeId) {
        assigneeMatch = String(m.assignedToId || "") === String(selectedEmployeeId);
      } else if (selectedTeamId) {
        const team = teamOptions.find((t) => t.id === selectedTeamId);
        const users = team?.userIds || [];
        assigneeMatch = users.includes(String(m.assignedToId || ""));
      }
      return statusMatch && stageMatch && assigneeMatch;
    }),
    [meetings, statusFilter, activeStage, selectedEmployeeId, selectedTeamId, teamOptions]
  );

  const filteredFollowupsByStatus = useMemo(
    () => visibleFollowups.filter((f) => {
      const statusMatch = statusFilter === "completed" ? isCompletedStatus(f.status) : !isCompletedStatus(f.status);
      let assigneeMatch = true;
      if (selectedEmployeeId) {
        assigneeMatch = String(f.assignedToId || "") === String(selectedEmployeeId);
      } else if (selectedTeamId) {
        const team = teamOptions.find((t) => t.id === selectedTeamId);
        const users = team?.userIds || [];
        assigneeMatch = users.includes(String(f.assignedToId || ""));
      }
      return statusMatch && assigneeMatch;
    }),
    [visibleFollowups, statusFilter, selectedEmployeeId, selectedTeamId, teamOptions]
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
    const meetingRemaining = meetings.filter((m) => !isCompletedStatus(m.status)).length;
    const meetingCompleted = meetings.filter((m) => isCompletedStatus(m.status)).length;
    const followupRemaining = visibleFollowups.filter((f) => !isCompletedStatus(f.status)).length;
    const followupCompleted = visibleFollowups.filter((f) => isCompletedStatus(f.status)).length;
    return {
      remaining: meetingRemaining + followupRemaining,
      completed: meetingCompleted + followupCompleted,
    };
  }, [meetings, visibleFollowups]);

  useEffect(() => {
    setMeetingPage(1);
    setFollowupPage(1);
  }, [statusFilter, activeStage, selectedTeamId, selectedEmployeeId]);

  useEffect(() => {
    if (meetingPage > meetingTotalPages) setMeetingPage(meetingTotalPages);
  }, [meetingPage, meetingTotalPages]);

  useEffect(() => {
    if (followupPage > followupTotalPages) setFollowupPage(followupTotalPages);
  }, [followupPage, followupTotalPages]);

  const handleMeetingDone = async (id) => {
    try {
      const res = await API.patch(`/followups/${id}/status`, { status: "completed" });
      const updated = mapDocToMeeting(res.data);
      setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated, status: "completed" } : m)));
      if (selectedMeeting?.id === id) setSelectedMeeting((prev) => ({ ...prev, ...updated, status: "completed" }));
    } catch (err) {
      console.error(err);
    }
  };

  const markDone = async (id) => {
    try {
      const res = await API.patch(`/followups/${id}/status`, { status: "completed" });
      const updated = mapDocToFollowup(res.data);
      setFollowups((prev) => prev.map((x) => (x.id === id ? updated : x)));
      if (selectedFollowup?.id === id) {
        setSelectedFollowup(updated);
      }
    } catch (err) {
      console.error(err);
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

    if (!meetingForm.client.trim()) return setMeetingFormError("Client is required");
    if (!meetingForm.title.trim()) return setMeetingFormError("Task is required");
    if (!meetingForm.dueDateTime) return setMeetingFormError("Date & time is required");
    if (isCompletedStatus(meetingForm.status) && !meetingForm.minutesOfMeeting.trim()) {
      return setMeetingFormError("Minutes of meeting is required for completed meetings");
    }

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

    if (!followupForm.client.trim()) return setFormError("Client is required");
    if (!followupForm.title.trim()) return setFormError("Task is required");
    if (!followupForm.dueDate) return setFormError("Due date is required");

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
      <div className="fuStages" role="tablist" aria-label="Follow-up stages">
        {STAGES.map((s) => (
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
        ))}
      </div>
      <div className="fuTopbar">
        <div className="fuTopbarLeft">
          <div className="fuTopbarGroup">
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
          <div className="fuTopbarGroup fuTopbarStages">
            {STAGES.map((s) => (
              <button
                key={s.key}
                className={cx("fuTopbarBtn", activeStage === s.key && "active")}
                type="button"
                onClick={() => {
                  setActiveStage(s.key);
                  if (followupMode === "all") setFollowupMode("list");
                }}
              >
                {s.key}
              </button>
            ))}
          </div>
        </div>
        {(currentRole === "admin" || currentRole === "manager") && (
          <div className="fuTopbarFilters">
            <select
              className="fuTopbarSelect"
              value={selectedTeamId}
              onChange={(e) => {
                setSelectedTeamId(e.target.value);
                setSelectedEmployeeId("");
              }}
            >
              <option value="">All Teams</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select
              className="fuTopbarSelect"
              value={selectedEmployeeId}
              onChange={(e) => {
                setSelectedEmployeeId(e.target.value);
                if (e.target.value) setSelectedTeamId("");
              }}
            >
              <option value="">All Employees</option>
              {employeeOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="fuTopbarScope">{scopeLabel}</div>
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
                    <button
                      className="fuBtn fuBtnPrimary"
                      type="button"
                      onClick={() => handleMeetingDone(selectedMeeting.id)}
                      disabled={isCompletedStatus(selectedMeeting.status)}
                    >
                      {isCompletedStatus(selectedMeeting.status) ? "Completed" : "Done"}
                    </button>
                    <button className="fuBtn fuBtnGhost" type="button" onClick={() => setMeetingMode("list")}>Back</button>
                  </div>
                </div>
                <div className="fuDetailsGrid">
                  <div className="fuDetailCard"><div className="k">Client</div><div className="v">{selectedMeeting.clientName}</div></div>
                  <div className="fuDetailCard"><div className="k">Task</div><div className="v">{selectedMeeting.title || selectedMeeting.eventType}</div></div>
                  <div className="fuDetailCard"><div className="k">Event Type</div><div className="v">{selectedMeeting.eventType}</div></div>
                  <div className="fuDetailCard"><div className="k">Time</div><div className="v">{selectedMeeting.time}</div></div>
                  <div className="fuDetailCard"><div className="k">Due</div><div className="v">{selectedMeeting.due}</div></div>
                  <div className="fuDetailCard"><div className="k">Priority</div><div className="v">{selectedMeeting.priority}</div></div>
                  <div className="fuDetailCard"><div className="k">Status</div><div className="v">{selectedMeeting.status}</div></div>
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
                {meetingFormError && <div className="fuEmptyBox">{meetingFormError}</div>}
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
                      {statusFilter === "completed" ? "No completed meetings for today." : "No remaining meetings for today."}
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
                {followupMode === "all" ? (
                  <>Showing: <span className="fuHintStrong">All stages</span></>
                ) : (
                  <>Stage: <span className="fuHintStrong">{activeStage}</span></>
                )}
              </div>
            </div>
          </header>

          <div className="fuPanelBody">
            {error && <div className="fuEmptyBox">{error}</div>}

            {followupMode === "view" && selectedFollowup ? (
              <div className="fuDetailsWrap">
                <div className="fuDetailsHead">
                  <div className="fuAllTitle">Follow-up Details</div>
                  <div className="fuPanelActions">
                    <button className="fuBtn fuBtnPrimary" type="button" onClick={() => openFollowupEdit(selectedFollowup)}>Edit</button>
                    <button className="fuBtn fuBtnGhost" type="button" onClick={() => setFollowupMode("list")}>Back</button>
                  </div>
                </div>
                <div className="fuDetailsGrid">
                  <div className="fuDetailCard"><div className="k">Client</div><div className="v">{selectedFollowup.client}</div></div>
                  <div className="fuDetailCard"><div className="k">Task</div><div className="v">{selectedFollowup.title}</div></div>
                  <div className="fuDetailCard"><div className="k">Stage</div><div className="v">{selectedFollowup.stage}</div></div>
                  <div className="fuDetailCard"><div className="k">Due</div><div className="v">{selectedFollowup.due}</div></div>
                  <div className="fuDetailCard"><div className="k">Priority</div><div className="v">{selectedFollowup.priority}</div></div>
                </div>
              </div>
            ) : followupMode === "edit" ? (
              <form className="fuFormScreen" onSubmit={submitFollowupEdit}>
                <div className="fuFormTitle">Edit Follow-up</div>
                {formError && <div className="fuEmptyBox">{formError}</div>}
                <div className="fuFormGrid">
                  <label className="fuFormLabel">
                    Client*
                    <input className="fuField" type="text" value={followupForm.client} onChange={(e) => setFollowupForm((p) => ({ ...p, client: e.target.value }))} />
                  </label>
                  <label className="fuFormLabel">
                    Stage
                    <select className="fuField" value={followupForm.stage} onChange={(e) => setFollowupForm((p) => ({ ...p, stage: e.target.value }))}>
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
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
                        : `No remaining follow-ups in ${activeStage}.`}
                    </div>
                  ) : (
                    visibleFollowupsByStatus.map((f) => (
                      <div key={f.id} className="fuItem">
                        <div className={cx("fuPriorityDot", f.priority)} title={`${f.priority} priority`} />
                        <div className="fuItemMain">
                          <div className="fuItemTitle">{f.client} - {f.title}</div>
                          <div className="fuItemMeta">
                            <span className="fuMetaChip">Due: {f.due}</span>
                            <span className="fuMetaChip">{f.actionType}</span>
                            <span className={cx("fuMetaChip", "stage")}>{f.stage}</span>
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
    </div>
  );
}
