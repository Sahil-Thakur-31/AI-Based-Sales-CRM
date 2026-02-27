import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
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

const EMPTY_FORM = {
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
  address: "",
  locationSearch: "",
  exactLocation: "",
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

function mapDocToMeeting(doc) {
  return {
    id: doc._id,
    clientName: doc.clientName || "N/A",
    eventType: doc.actionType || "Meeting",
    time: formatTime(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    status: doc.status || "pending",
    priority: doc.priority || "medium",
    notes: doc.notes || "",
    durationMinutes: doc.durationMinutes || "",
    agenda: doc.agenda || "",
    address: doc.address || "",
    exactLocation: doc.exactLocation || "",
  };
}

function mapDocToFollowup(doc) {
  return {
    id: doc._id,
    stage: doc.stage || "P1",
    title: doc.title || "",
    client: doc.clientName || "N/A",
    due: formatDate(doc.dueDateTime),
    dueDateTime: doc.dueDateTime,
    priority: doc.priority || "medium",
    eventType: doc.actionType || "Follow Up Phone Call",
    time: formatTime(doc.dueDateTime),
    notes: doc.notes || "",
    status: doc.status || "pending",
  };
}

function completionText(status = "") {
  return String(status).toLowerCase() === "completed" ? "Completed" : "Not Completed";
}

function isMeetingEventType(eventType = "") {
  return String(eventType).toLowerCase().includes("meeting");
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

  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [loadingClientSuggestions, setLoadingClientSuggestions] = useState(false);

  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [scopeLabel, setScopeLabel] = useState("Sales Scope: My Records");

  const visibleFollowups = useMemo(
    () => followups.filter((f) => f.stage === activeStage),
    [followups, activeStage]
  );

  const stageByClientId = useMemo(() => {
    const map = new Map();
    (dealRows || []).forEach((d) => {
      if (!d?.clientId || !d?.stage) return;
      if (!map.has(String(d.clientId))) {
        map.set(String(d.clientId), d.stage);
      }
    });
    return map;
  }, [dealRows]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [mRes, fRes, dRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting" } }),
        API.get("/followups", { params: { kind: "followup" } }),
        API.get("/deals"),
      ]);
      setMeetings((mRes.data || []).map(mapDocToMeeting));
      setFollowups((fRes.data || []).map(mapDocToFollowup));
      setDealRows(dRes.data || []);
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
    if (rawRole === "admin") setScopeLabel("Admin Scope: My + Managers + Sales");
    else if (rawRole === "manager") setScopeLabel("Manager Scope: My + Team");
    else setScopeLabel("Sales Scope: My Records");
  }, []);

  const resetForm = () => {
    setFormData({ ...EMPTY_FORM });
    setFormError("");
    setEditingRecord(null);
    setSelectedClientId("");
    setClientSuggestions([]);
    setLocationSuggestions([]);
  };

  const applyClientSelection = (client) => {
    const id = String(client?._id || "");
    const dealStage = id ? stageByClientId.get(id) || "" : "";
    setSelectedClientId(id);
    setFormData((p) => ({
      ...p,
      searchClient: client?.name || "",
      stage: dealStage,
    }));
    setClientSuggestions([]);
  };

  useEffect(() => {
    const q = formData.searchClient.trim();
    if (!q || selectedClientId) {
      if (!q) setClientSuggestions([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoadingClientSuggestions(true);
        const res = await API.get("/deals/client-suggestions", { params: { q, limit: 8 } });
        setClientSuggestions(res.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingClientSuggestions(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [formData.searchClient, selectedClientId]);

  useEffect(() => {
    if (formData.eventType !== "Physical Meeting") {
      setLocationSuggestions([]);
      return;
    }

    const query = formData.locationSearch.trim();
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
  }, [formData.locationSearch, formData.eventType]);

  const validateForm = () => {
    if (!formData.eventType.trim()) return "Event type is required";
    if (!formData.time.trim()) return "Time is required";
    if (!formData.searchClient.trim()) return "Client is required";
    if (!selectedClientId) return "Select a client from suggestions";
    if (!(formData.taskDescription || formData.purpose).trim()) return "Purpose/Task description is required";
    if (!formData.date) return "Date is required";
    const selectedAt = new Date(`${formData.date}T${formData.time}:00`);
    if (!Number.isNaN(selectedAt.getTime()) && selectedAt < new Date()) {
      return "Past date/time is not allowed";
    }
    if (!formData.stage) return "Stage not found for selected client in deals";
    if (formData.eventType === "Physical Meeting" && !formData.exactLocation.trim()) return "Select a location from suggestions";
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
    const matchedDeal = (dealRows || []).find(
      (d) => String(d.clientName || "").toLowerCase() === String(existingName || "").toLowerCase()
    );
    const matchedClientId = matchedDeal?.clientId ? String(matchedDeal.clientId) : "";
    const matchedStage = matchedClientId ? stageByClientId.get(matchedClientId) || "" : "";

    setFormTarget(type);
    setEditingRecord({ type, id: item.id });
    if (type === "meeting") {
      setFormData({
        ...EMPTY_FORM,
        eventType: item.eventType || "",
        time: item.time || "",
        date: toDateInputValue(item.dueDateTime),
        searchClient: item.clientName || "",
        purpose: item.notes || "",
        taskDescription: item.notes || "",
        priority: item.priority || "medium",
        durationMinutes: item.durationMinutes || "",
        agenda: item.agenda || "",
        address: item.address || "",
        locationSearch: item.address || "",
        exactLocation: item.exactLocation || "",
        stage: matchedStage,
      });
    } else {
      setFormData({
        ...EMPTY_FORM,
        eventType: item.eventType || "Follow Up Phone Call",
        time: item.time || "",
        date: toDateInputValue(item.dueDateTime),
        searchClient: item.client || "",
        purpose: item.title || "",
        taskDescription: item.title || "",
        priority: item.priority || "medium",
        stage: matchedStage,
      });
    }
    setSelectedClientId(matchedClientId);
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
      const dueDateTime = new Date(`${formData.date}T${formData.time}:00`).toISOString();
      const payload = {
        kind: resolvedTarget === "meeting" ? "meeting" : "followup",
        actionType: formData.eventType,
        title: (formData.taskDescription || formData.purpose).trim(),
        clientName: formData.searchClient.trim(),
        stage: formData.stage || activeStage,
        dueDateTime,
        priority: formData.priority || "medium",
        notes: formData.purpose || formData.taskDescription,
        durationMinutes: formData.durationMinutes || undefined,
        agenda: formData.agenda || "",
        address: formData.address.trim() || formData.locationSearch.trim() || "",
        exactLocation: formData.exactLocation || "",
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
      const selectedLatLng = parseLatLng(formData.exactLocation);
      const todayISO = getTodayISO();
      const minTime = formData.date === todayISO ? getNowTimeHHMM() : undefined;
      return (
        <form className="fuaForm" onSubmit={submitForm}>
          {formError && <div className="fuaEmpty">{formError}</div>}
          <div className="fuaGrid">
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
          <input type="time" min={minTime} value={formData.time} onChange={(e) => setFormData((p) => ({ ...p, time: e.target.value }))} />
        </label>

        <label>
          Date*
          <input type="date" min={todayISO} value={formData.date} onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))} />
        </label>

        <label>
          Search Client*
          <div className="fuaSuggestField">
            <input
              type="text"
              placeholder="Type client name"
              value={formData.searchClient}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedClientId("");
                setFormData((p) => ({ ...p, searchClient: next, stage: "" }));
              }}
            />
            {loadingClientSuggestions && <span className="fuaHint">Searching clients...</span>}
            {!selectedClientId && clientSuggestions.length > 0 && (
              <div className="fuaSuggestList">
                {clientSuggestions.map((c) => (
                  <button key={String(c._id)} type="button" className="fuaSuggestItem" onClick={() => applyClientSelection(c)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <label className="full">
          Purpose / Task Description*
          <input type="text" placeholder="Purpose of meeting / task" value={formData.taskDescription || formData.purpose} onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value, taskDescription: e.target.value }))} />
        </label>

        <label>
          Stage (From Deal)
          <input type="text" value={formData.stage || "No stage found"} readOnly />
        </label>

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
            <label className="full">
              Agenda of Meeting
              <input type="text" placeholder="Enter agenda" value={formData.agenda} onChange={(e) => setFormData((p) => ({ ...p, agenda: e.target.value }))} />
            </label>
          </>
        )}

        {formData.eventType === "Physical Meeting" && (
          <>
            <label className="full">
              Address*
              <input
                type="text"
                placeholder="Enter address manually"
                value={formData.address}
                onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
              />
            </label>
            <label className="full">
              Location (Search & Suggest)
              <div className="fuaSuggestField">
                <input
                  type="text"
                  placeholder="Type area, landmark, city..."
                  value={formData.locationSearch}
                  onChange={(e) => setFormData((p) => ({ ...p, locationSearch: e.target.value, exactLocation: "" }))}
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
                            locationSearch: loc.display_name || p.locationSearch,
                            address: p.address || loc.display_name || "",
                            exactLocation: `${Number(loc.lat).toFixed(6)}, ${Number(loc.lon).toFixed(6)}`,
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

  const renderMeetings = () => (
    <div className="fuaList">
      {meetings.map((m) => (
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
      {meetings.length === 0 && <div className="fuaEmpty">No meetings.</div>}
    </div>
  );

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
          ["Address", item.address || "N/A"],
          ["Location", item.exactLocation || "N/A"],
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
        ];

    return (
      <div className="fuaDetails">
        <div className="fuaDetailsHead">
          <h3>{type === "meeting" ? "Meeting Details" : "Followup Details"}</h3>
          <div className="fuaActions">
            <button className="fuaBtn primary" type="button" onClick={openEditFromDetails}>Edit</button>
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
      <div className="fuaScope">{scopeLabel}</div>
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
        {!loading && activeAction === "followup" && renderFollowups(followups)}
        {!loading && activeAction === "meeting" && renderMeetings()}
        {!loading && activeAction === "view" && renderDetails()}
        {!loading && activeAction === "filter" && (
          <>
            <div className="fuaStages">
              {STAGES.map((s) => (
                <button key={s.key} className={cx("fuaStageBtn", activeStage === s.key && "active")} type="button" onClick={() => setActiveStage(s.key)}>
                  {s.title}
                </button>
              ))}
            </div>
            {renderFollowups(visibleFollowups)}
          </>
        )}
      </section>
    </div>
  );
}
