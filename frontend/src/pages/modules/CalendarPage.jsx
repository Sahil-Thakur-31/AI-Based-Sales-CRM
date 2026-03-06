import React, { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import interactionPlugin from "@fullcalendar/interaction";
import {
  FaCalendarDays,
  FaFilter,
  FaMagnifyingGlass,
  FaCalendarCheck,
  FaList,
  FaBolt,
  FaBell,
  FaUser,
  FaPenToSquare,
  FaTrashCan,
  FaBan,
  FaXmark,
} from "react-icons/fa6";

import API from "../../api";
import meetingImg from "../../assets/calendar/meeting.png";
import dailyImg from "../../assets/calendar/daily-tasks.png";
import expoImg from "../../assets/calendar/team-building.png";
import "./styles/CalendarPage.css";

const CATEGORY_COLORS = {
  meeting: "#4285F4",
  daily_closing: "#34A853",
  event_expo: "#FBBC04",
};

const CATEGORY_LABELS = {
  meeting: "Meeting & Reminder",
  daily_closing: "Daily Closing",
  event_expo: "Event & Expo",
};

const CATEGORY_IMAGES = {
  meeting: meetingImg,
  daily_closing: dailyImg,
  event_expo: expoImg,
};

const CATEGORY_ROUTES = {
  meeting: "/followups/add",
  daily_closing: "/daily-closing/form",
  event_expo: "/events/new",
};

const CATEGORIES = ["meeting", "daily_closing", "event_expo"];
const DEFAULT_REMINDER_OPTIONS = [
  { channel: "notification", value: 10, unit: "minutes" },
];

function prettyPriority(priority = "medium") {
  const p = String(priority || "medium");
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function inferMeetingType(actionType = "") {
  const t = String(actionType).toLowerCase();
  if (t.includes("online")) return "online";
  if (t.includes("call")) return "call";
  if (t.includes("offline") || t.includes("physical")) return "offline";
  return "other";
}

function formatEventDate(start, end) {
  if (!start) return "";
  const opts = { weekday: "long", month: "long", day: "numeric" };
  const startDate = new Date(start);
  const dateStr = startDate.toLocaleDateString(undefined, opts);
  if (!end) return dateStr;
  const startTime = startDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endDate = new Date(end);
  const endTime = endDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateStr} · ${startTime} - ${endTime}`;
}

function toCalendarEvent(doc) {
  const start = new Date(doc.dueDateTime);
  const duration = Number(doc.durationMinutes) > 0 ? Number(doc.durationMinutes) : 45;
  const end = new Date(start.getTime() + duration * 60 * 1000);

  return {
    id: String(doc._id),
    title: doc.title || "Meeting",
    start: start.toISOString(),
    end: end.toISOString(),
    backgroundColor: CATEGORY_COLORS.meeting,
    borderColor: CATEGORY_COLORS.meeting,
    extendedProps: {
      type: "meeting",
      withWhom: doc.clientName || "N/A",
      topic: doc.title || "",
      meetingType: inferMeetingType(doc.actionType),
      priority: prettyPriority(doc.priority),
      reminderEnabled: doc.reminderEnabled !== false,
      reminderChoice:
        doc.reminderChoice || doc.reminderPreference || (doc.reminderEnabled === false ? "no" : "yes"),
      reminderOptions:
        Array.isArray(doc.reminderOptions) && doc.reminderOptions.length > 0
          ? doc.reminderOptions.map((opt) => ({
              channel: "notification",
              value: Number(opt?.value) > 0 ? Number(opt.value) : 10,
              unit: ["minutes", "hours", "days"].includes(String(opt?.unit || "").toLowerCase())
                ? String(opt.unit).toLowerCase()
                : "minutes",
            }))
          : DEFAULT_REMINDER_OPTIONS,
      organizer: doc.assignedTo?.name || "",
      notes: doc.notes || "",
    },
  };
}

function isGoogleSyncedRecord(doc) {
  return !!String(doc?.googleEventId || "").trim();
}

export default function CalendarPage() {
  const calendarRef = useRef(null);
  const popoverRef = useRef(null);
  const filterBtnRef = useRef(null);
  const filterDropRef = useRef(null);

  const [currentView, setCurrentView] = useState("dayGridMonth");
  const [currentTitle, setCurrentTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState([...CATEGORIES]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [popover, setPopover] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingReminder, setSavingReminder] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderChoice, setReminderChoice] = useState("yes");
  const [reminderOptions, setReminderOptions] = useState(DEFAULT_REMINDER_OPTIONS);
  const [googleSync, setGoogleSync] = useState({ connected: false, connectedAt: null });
  const [syncLoading, setSyncLoading] = useState(false);

  const loadGoogleStatus = async () => {
    try {
      const res = await API.get("/auth/google/status");
      setGoogleSync({
        connected: !!res.data?.connected,
        connectedAt: res.data?.connectedAt || null,
      });
    } catch {
      setGoogleSync({ connected: false, connectedAt: null });
    }
  };

  const loadFollowups = async () => {
    setLoading(true);
    try {
      const [meetingsRes, followupsRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting" } }),
        API.get("/followups", { params: { kind: "followup" } }),
      ]);

      const rows = [...(meetingsRes.data || []), ...(followupsRes.data || [])].filter((doc) => {
        if (doc.is_deleted || doc.status === "cancelled") return false;
        return isGoogleSyncedRecord(doc);
      });
      setEvents(rows.map(toCalendarEvent));
    } catch (err) {
      console.error("Calendar load failed:", err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoogleStatus();
    loadFollowups();
  }, []);

  useEffect(() => {
    const closeOnOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setPopover(null);
        setEditingReminder(false);
      }
      if (
        filterDropRef.current &&
        !filterDropRef.current.contains(e.target) &&
        filterBtnRef.current &&
        !filterBtnRef.current.contains(e.target)
      ) {
        setFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  const nav = (fn) => () => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    api[fn]();
    setCurrentTitle(api.view.title);
  };

  const handleViewChange = (e) => {
    const nextView = e.target.value;
    setCurrentView(nextView);
    const api = calendarRef.current?.getApi();
    if (!api) return;
    api.changeView(nextView);
    setCurrentTitle(api.view.title);
  };

  const toggleFilter = (type) => {
    setActiveFilters((prev) =>
      prev.includes(type) ? prev.filter((key) => key !== type) : [...prev, type]
    );
  };

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev) => {
      const text = `${ev.title} ${ev.extendedProps?.withWhom || ""} ${
        ev.extendedProps?.topic || ""
      }`.toLowerCase();
      return activeFilters.includes(ev.extendedProps?.type) && (!q || text.includes(q));
    });
  }, [events, searchQuery, activeFilters]);

  const hiddenCount = CATEGORIES.length - activeFilters.length;

  const handleEventClick = (info) => {
    info.jsEvent.stopPropagation();
    const rect = info.el.getBoundingClientRect();
    let x = rect.left + rect.width / 2 - 200;
    let y = rect.bottom + 8;
    const maxPopoverHeight = Math.floor(window.innerHeight * 0.85);
    x = Math.max(8, Math.min(x, window.innerWidth - 420));
    y = Math.max(8, Math.min(y, window.innerHeight - maxPopoverHeight - 8));
    setPopover({ event: info.event, x, y });
    setEditingReminder(false);
    setReminderChoice(
      info.event.extendedProps?.reminderChoice ||
        (info.event.extendedProps?.reminderEnabled === false ? "no" : "yes")
    );
    setReminderOptions(
      Array.isArray(info.event.extendedProps?.reminderOptions) &&
        info.event.extendedProps.reminderOptions.length > 0
        ? info.event.extendedProps.reminderOptions.map((opt) => ({
            channel: "notification",
            value: Number(opt?.value) > 0 ? Number(opt.value) : 10,
            unit: ["minutes", "hours", "days"].includes(String(opt?.unit || "").toLowerCase())
              ? String(opt.unit).toLowerCase()
              : "minutes",
          }))
        : DEFAULT_REMINDER_OPTIONS
    );
  };

  const saveReminderOnly = async () => {
    if (!popover?.event?.id) return;
    setSavingReminder(true);
    try {
      const reminderEnabled = reminderChoice !== "no";
      const normalizedOptions =
        reminderChoice === "yes"
          ? reminderOptions
              .map((opt) => ({
                channel: "notification",
                value: Math.max(1, Number(opt?.value) || 1),
                unit: ["minutes", "hours", "days"].includes(String(opt?.unit || "").toLowerCase())
                  ? String(opt.unit).toLowerCase()
                  : "minutes",
              }))
              .filter((opt) => Number.isFinite(opt.value))
          : [];

      await API.put(`/followups/${popover.event.id}`, {
        reminderEnabled,
        reminderChoice,
        reminderOptions: normalizedOptions,
      });

      setEvents((prev) =>
        prev.map((ev) =>
          ev.id !== popover.event.id
            ? ev
            : {
                ...ev,
                extendedProps: {
                  ...ev.extendedProps,
                  reminderEnabled,
                  reminderChoice,
                  reminderOptions: normalizedOptions,
                },
              }
        )
      );

      setPopover((prev) =>
        prev
          ? {
              ...prev,
              event: {
                ...prev.event,
                extendedProps: {
                  ...prev.event.extendedProps,
                  reminderEnabled,
                  reminderChoice,
                  reminderOptions: normalizedOptions,
                },
              },
            }
          : prev
      );

      setEditingReminder(false);
    } catch (err) {
      console.error("Reminder update failed:", err);
    } finally {
      setSavingReminder(false);
    }
  };

  const cancelMeeting = async () => {
    if (!popover?.event?.id) return;
    try {
      await API.put(`/followups/${popover.event.id}/status`, { status: "cancelled" });
      setEvents((prev) => prev.filter((ev) => ev.id !== popover.event.id));
      setPopover(null);
      setEditingReminder(false);
    } catch (err) {
      console.error("Cancel meeting failed:", err);
    }
  };

  const deleteMeeting = async () => {
    if (!popover?.event?.id) return;
    try {
      await API.delete(`/followups/${popover.event.id}`);
      setEvents((prev) => prev.filter((ev) => ev.id !== popover.event.id));
      setPopover(null);
      setEditingReminder(false);
    } catch (err) {
      console.error("Delete meeting failed:", err);
    }
  };

  const addReminderOptionRow = () => {
    setReminderOptions((prev) => [...prev, { channel: "notification", value: 10, unit: "minutes" }]);
  };

  const updateReminderOptionRow = (index, key, value) => {
    setReminderOptions((prev) =>
      prev.map((row, i) =>
        i !== index
          ? row
          : {
              ...row,
              [key]: key === "value" ? Math.max(1, Number(value) || 1) : value,
            }
      )
    );
  };

  const removeReminderOptionRow = (index) => {
    setReminderOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : DEFAULT_REMINDER_OPTIONS;
    });
  };

  const toggleGoogleSync = async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      if (googleSync.connected) {
        await API.delete("/auth/google/disconnect");
        setGoogleSync({ connected: false, connectedAt: null });
      } else {
        const token = localStorage.getItem("token");
        window.location.href = `http://localhost:8080/auth/google?token=${token}`;
      }
    } catch (err) {
      console.error("Google sync toggle failed:", err);
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="calendar-layout">
      <div className="calendar-topbar">
        <div className="calendar-topbar-left">
          <button className="cal-btn" onClick={nav("today")}>
            Today
          </button>
          <button className="cal-icon-btn" onClick={nav("prev")}>
            &#8249;
          </button>
          <button className="cal-icon-btn" onClick={nav("next")}>
            &#8250;
          </button>
          <h2 className="calendar-title">{currentTitle}</h2>
        </div>

        <div className="calendar-topbar-right">
          <div className="cal-search-box">
            <span className="search-icon">
              <FaMagnifyingGlass />
            </span>
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-dropdown-wrapper">
            <button
              ref={filterBtnRef}
              className={`cal-btn filter-toggle-btn ${filterOpen ? "active" : ""}`}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <FaFilter /> Filter
              {hiddenCount > 0 && <span className="filter-badge">{hiddenCount}</span>}
            </button>

            {filterOpen && (
              <div ref={filterDropRef} className="filter-dropdown">
                {CATEGORIES.map((key) => (
                  <label key={key} className="filter-drop-row">
                    <input
                      type="checkbox"
                      checked={activeFilters.includes(key)}
                      onChange={() => toggleFilter(key)}
                      style={{ accentColor: CATEGORY_COLORS[key] }}
                    />
                    <img src={CATEGORY_IMAGES[key]} alt="" className="filter-drop-img" />
                    <span className="filter-drop-label" style={{ color: CATEGORY_COLORS[key] }}>
                      {CATEGORY_LABELS[key]}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <select className="cal-view-select" value={currentView} onChange={handleViewChange}>
            <option value="timeGridDay">Day</option>
            <option value="timeGridWeek">Week</option>
            <option value="dayGridMonth">Month</option>
            <option value="multiMonthYear">Year</option>
            <option value="listWeek">Schedule</option>
          </select>

          <button className="cal-gsync-card" onClick={toggleGoogleSync} disabled={syncLoading}>
            <span className="cal-gsync-icon">
              <FaCalendarDays />
            </span>
            <span className="cal-gsync-text">
              <strong>Google Calendar Sync</strong>
              <small>
                {googleSync.connected
                  ? `Connected on ${new Date(googleSync.connectedAt).toLocaleDateString()}`
                  : "Not connected"}
              </small>
            </span>
            <span className={`cal-gsync-switch ${googleSync.connected ? "on" : ""}`}>
              <span className="cal-gsync-knob" />
            </span>
          </button>
        </div>
      </div>

      <div className="calendar-body">
        <div className="calendar-main">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            events={filteredEvents}
            height="100%"
            expandRows
            dayMaxEvents
            fixedWeekCount={false}
            multiMonthMaxColumns={4}
            datesSet={(arg) => setCurrentTitle(arg.view.title)}
            eventClick={handleEventClick}
            eventContent={(arg) => {
              const color = arg.event.backgroundColor || "#3c4043";
              return (
                <div className="cal-event-text" style={{ color }}>
                  <span className="cal-ev-time">{arg.timeText}</span>
                  <span className="cal-ev-title">{arg.event.title}</span>
                </div>
              );
            }}
          />
          {loading && <div className="cal-loading">Loading calendar...</div>}
        </div>

        <div className="calendar-right-panel">
          <div className="add-icon-list">
            {CATEGORIES.map((key) => (
              <a
                key={key}
                href={CATEGORY_ROUTES[key]}
                className="add-icon-btn"
                style={{ "--card-color": CATEGORY_COLORS[key] }}
                data-label={CATEGORY_LABELS[key]}
              >
                <img src={CATEGORY_IMAGES[key]} alt={CATEGORY_LABELS[key]} className="add-icon-img" />
              </a>
            ))}
          </div>
        </div>
      </div>

      {popover && (() => {
        const ev = popover.event;
        const props = ev.extendedProps || {};
        const dateStr = formatEventDate(ev.startStr, ev.endStr);

        return (
          <div
            ref={popoverRef}
            className="event-popover"
            style={{ position: "fixed", left: popover.x, top: popover.y }}
          >
            <div className="ep-header">
              <div className="ep-actions">
                <button
                  className="ep-action-btn ep-edit"
                  title="Edit reminder only"
                  onClick={() => setEditingReminder((prev) => !prev)}
                >
                  <FaPenToSquare />
                </button>
                <button className="ep-action-btn ep-delete" title="Delete meeting" onClick={deleteMeeting}>
                  <FaTrashCan />
                </button>
                <button className="ep-action-btn ep-cancel" title="Cancel meeting" onClick={cancelMeeting}>
                  <FaBan />
                </button>
                <button className="ep-action-btn ep-close" title="Close" onClick={() => setPopover(null)}>
                  <FaXmark />
                </button>
              </div>
            </div>

            <div className="ep-title-row">
              <span className="ep-color-dot" style={{ background: CATEGORY_COLORS.meeting }} />
              <div>
                <div className="ep-title">{ev.title}</div>
                <div className="ep-date">{dateStr}</div>
              </div>
            </div>

            <div className="ep-detail-row">
              <FaCalendarCheck className="ep-detail-icon" />
              <span>{CATEGORY_LABELS.meeting}</span>
            </div>
            <div className="ep-detail-row">
              <FaList className="ep-detail-icon" />
              <span>Topic: {props.topic || "-"}</span>
            </div>
            <div className="ep-detail-row">
              <FaUser className="ep-detail-icon" />
              <span>With: {props.withWhom || "-"}</span>
            </div>
            <div className="ep-detail-row">
              <FaList className="ep-detail-icon" />
              <span>Type: {props.meetingType || "other"}</span>
            </div>
            <div className="ep-detail-row">
              <FaBolt className="ep-detail-icon" />
              <span>Priority: {props.priority || "Medium"}</span>
            </div>

            <div className="ep-detail-row ep-reminder-row">
              <FaBell className="ep-detail-icon" />
              {!editingReminder ? (
                <span>
                  Reminder:{" "}
                  {props.reminderChoice === "maybe" ? "Maybe" : props.reminderEnabled === false ? "No" : "Yes"}
                </span>
              ) : (
                <div className="ep-reminder-edit">
                  <select
                    className="ep-select"
                    value={reminderChoice}
                    onChange={(e) => setReminderChoice(e.target.value)}
                    disabled={savingReminder}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="maybe">Maybe</option>
                  </select>
                  {reminderChoice === "yes" && (
                    <div className="ep-notify-options">
                      {reminderOptions.map((opt, idx) => (
                        <div className="ep-notify-row" key={`notify-row-${idx}`}>
                          <div className="ep-notify-label">Notification</div>
                          <input
                            className="ep-notify-number"
                            type="number"
                            min="1"
                            value={opt.value}
                            onChange={(e) => updateReminderOptionRow(idx, "value", e.target.value)}
                            disabled={savingReminder}
                          />
                          <select
                            className="ep-select"
                            value={opt.unit}
                            onChange={(e) => updateReminderOptionRow(idx, "unit", e.target.value)}
                            disabled={savingReminder}
                          >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                          <button
                            type="button"
                            className="ep-action-btn ep-close"
                            onClick={() => removeReminderOptionRow(idx)}
                            disabled={savingReminder}
                            title="Remove notification row"
                          >
                            <FaXmark />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="ep-add-reminder-row"
                        onClick={addReminderOptionRow}
                        disabled={savingReminder}
                      >
                        + Add notification
                      </button>
                    </div>
                  )}
                  <button className="ep-save-btn" onClick={saveReminderOnly} disabled={savingReminder}>
                    {savingReminder ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
