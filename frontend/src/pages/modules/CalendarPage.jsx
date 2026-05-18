import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  FaBan,
  FaXmark,
  FaEye,
} from "react-icons/fa6";

import API from "../../api";
import { handleError, handleSuccess } from "../../utils";
import meetingImg from "../../assets/calendar/meeting.png";
import dailyImg from "../../assets/calendar/daily-tasks.png";
import expoImg from "../../assets/calendar/team-building.png";
import "./styles/CalendarPage.css";

const CATEGORY_COLORS = {
  meeting: "#4285F4",
  daily_closing: "#34A853",
  event_expo: "#FBBC04",
};
const CANCELLED_COLOR = "#dc2626";

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
  event_expo: "/events/register",
};

const CATEGORIES = ["meeting", "daily_closing", "event_expo"];
const DEFAULT_REMINDER_OPTIONS = [
  { channel: "notification", value: 10, unit: "minutes" },
];
const EXPO_REMINDER_STORE_KEY = "calendar_event_expo_reminder_v1";

function prettyPriority(priority = "medium") {
  const p = String(priority || "medium");
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function isCancelledStatus(status = "") {
  return String(status || "").trim().toLowerCase() === "cancelled";
}

function getCalendarItemColor(type = "meeting", status = "") {
  if (isCancelledStatus(status)) return CANCELLED_COLOR;
  return CATEGORY_COLORS[type] || CATEGORY_COLORS.meeting;
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
  const color = getCalendarItemColor("meeting", doc.status);

  return {
    id: String(doc._id),
    title: doc.title || "Meeting",
    start: start.toISOString(),
    end: end.toISOString(),
    backgroundColor: color,
    borderColor: color,
    extendedProps: {
      type: "meeting",
      sourceKind: doc.kind || "followup",
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
      status: String(doc.status || "pending").toLowerCase(),
      cancelReason: doc.cancelReason || "",
    },
  };
}

function readExpoReminderStore() {
  try {
    const raw = localStorage.getItem(EXPO_REMINDER_STORE_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeExpoReminderStore(map) {
  try {
    localStorage.setItem(EXPO_REMINDER_STORE_KEY, JSON.stringify(map || {}));
  } catch {
    // ignore storage failures
  }
}

function toEventExpoCalendarEvent(doc) {
  const start = doc?.startDate ? new Date(doc.startDate) : null;
  const end = doc?.endDate ? new Date(doc.endDate) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const sourceId = String(doc?._id || "");
  const reminderStore = readExpoReminderStore();
  const reminderSaved = reminderStore[sourceId] || {};
  const reminderChoice = String(reminderSaved.reminderChoice || "yes").toLowerCase();
  const reminderEnabled = reminderChoice !== "no";
  const reminderOptions = Array.isArray(reminderSaved.reminderOptions) && reminderSaved.reminderOptions.length
    ? reminderSaved.reminderOptions
    : DEFAULT_REMINDER_OPTIONS;
  const color = getCalendarItemColor("event_expo", doc?.status);

  return {
    id: `event-${sourceId}`,
    title: doc.name || "Event & Expo",
    start: start.toISOString(),
    end: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    extendedProps: {
      type: "event_expo",
      venue: doc.venue || "",
      address: doc.address || "",
      notes: doc.description || "",
      registrationFee: doc.registrationFee,
      sourceId,
      reminderEnabled,
      reminderChoice,
      reminderOptions,
      status: String(doc?.status || "upcoming").toLowerCase(),
    },
  };
}

function toDailyClosingCalendarEvent(doc) {
  const date = doc?.daily_closing_date ? new Date(doc.daily_closing_date) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return {
    id: `daily-${String(doc._id || doc.daily_closing_date)}`,
    title: "Daily Closing Task",
    start: date.toISOString(),
    allDay: true,
    backgroundColor: CATEGORY_COLORS.daily_closing,
    borderColor: CATEGORY_COLORS.daily_closing,
    extendedProps: {
      type: "daily_closing",
      notes: doc.key_highlights || "",
      reminderEnabled: false,
      reminderChoice: "no",
      reminderOptions: [],
    },
  };
}

function buildMissingDailyTaskReminderEvent() {
  const now = new Date();
  const reminderStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    20,
    0,
    0,
    0
  );
  const reminderEnd = new Date(reminderStart.getTime() + 60 * 60 * 1000);
  return {
    id: `daily-reminder-${now.toISOString().slice(0, 10)}`,
    title: "Reminder: Add today's Daily Closing task",
    start: reminderStart.toISOString(),
    end: reminderEnd.toISOString(),
    allDay: false,
    backgroundColor: CATEGORY_COLORS.daily_closing,
    borderColor: CATEGORY_COLORS.daily_closing,
    extendedProps: {
      type: "daily_closing",
      notes: "You have not added today's daily closing task yet.",
      reminderEnabled: false,
      reminderChoice: "no",
      reminderOptions: [],
      isPrompt: true,
    },
  };
}

function shouldShowDailyClosingReminderNow() {
  const now = new Date();
  const reminderThreshold = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    20,
    0,
    0,
    0
  );
  return now >= reminderThreshold;
}

function formatLocalDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const calendarRef = useRef(null);
  const popoverRef = useRef(null);
  const filterBtnRef = useRef(null);
  const filterDropRef = useRef(null);
  const dayMenuRef = useRef(null);
  const syncTimerRef = useRef(null);
  const lastSyncedFingerprintRef = useRef("");

  const [currentView, setCurrentView] = useState("dayGridMonth");
  const [currentTitle, setCurrentTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState([...CATEGORIES]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [popover, setPopover] = useState(null);
  const [dayMenu, setDayMenu] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingReminder, setSavingReminder] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editingDailyClosing, setEditingDailyClosing] = useState(false);
  const [dailyClosingNotesDraft, setDailyClosingNotesDraft] = useState("");
  const [savingDailyClosing, setSavingDailyClosing] = useState(false);
  const [cancelModal, setCancelModal] = useState({
    open: false,
    eventId: "",
    itemType: "meeting",
    title: "",
    reason: "",
    error: "",
    saving: false,
  });
  const [reminderChoice, setReminderChoice] = useState("yes");
  const [reminderOptions, setReminderOptions] = useState(DEFAULT_REMINDER_OPTIONS);
  const [googleSync, setGoogleSync] = useState({ connected: false, connectedAt: null });
  const [syncLoading, setSyncLoading] = useState(false);
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const isManager = roleName === "manager";
  const isAdmin = roleName === "admin";

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

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      const [meetingsRes, followupsRes, eventsRes, dailyClosingRes] = await Promise.all([
        API.get("/followups", { params: { kind: "meeting", mine_only: true } }),
        API.get("/followups", { params: { kind: "followup", mine_only: true } }),
        API.get("/events", { params: { mine_only: true } }),
        isAdmin ? Promise.resolve({ data: { rows: [], hasTodayEntry: true } }) : API.get("/daily-closing/calendar-self"),
      ]);

      const meetingRows = [...(meetingsRes.data || []), ...(followupsRes.data || [])].filter((doc) => !doc.is_deleted);
      const meetingEvents = meetingRows.map(toCalendarEvent).filter(Boolean);
      const expoEvents = (Array.isArray(eventsRes.data) ? eventsRes.data : [])
        .map(toEventExpoCalendarEvent)
        .filter(Boolean);
      const dailyRows = Array.isArray(dailyClosingRes?.data?.rows) ? dailyClosingRes.data.rows : [];
      const dailyEvents = dailyRows.map(toDailyClosingCalendarEvent).filter(Boolean);
      const hasTodayEntry = Boolean(dailyClosingRes?.data?.hasTodayEntry);
      const missingDailyReminder =
        hasTodayEntry || !shouldShowDailyClosingReminderNow()
          ? []
          : [buildMissingDailyTaskReminderEvent()];

      setEvents([...meetingEvents, ...expoEvents, ...dailyEvents, ...missingDailyReminder]);
    } catch (err) {
      console.error("Calendar load failed:", err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoogleStatus();
    loadCalendarData();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadCalendarData();
    };
    const onFocus = () => loadCalendarData();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const closeOnOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setPopover(null);
        setEditingReminder(false);
        setEditingDailyClosing(false);
      }
      if (dayMenuRef.current && !dayMenuRef.current.contains(e.target)) {
        setDayMenu(null);
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
      const text = `${ev.title} ${ev.extendedProps?.withWhom || ""} ${ev.extendedProps?.topic || ""
        }`.toLowerCase();
      return activeFilters.includes(ev.extendedProps?.type) && (!q || text.includes(q));
    });
  }, [events, searchQuery, activeFilters]);

  useEffect(() => {
    if (!googleSync.connected || loading) return;

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = window.setTimeout(async () => {
      const items = filteredEvents
        .map((ev) => {
          const type = String(ev?.extendedProps?.type || "").toLowerCase();
          if (!type) return null;

          let startStr = ev?.start instanceof Date ? ev.start.toISOString() : (ev?.startStr || ev?.start || null);
          let endStr = ev?.end instanceof Date ? ev.end.toISOString() : (ev?.endStr || ev?.end || null);

          if (ev?.allDay) {
            if (ev.start) startStr = formatLocalDateInput(new Date(ev.start));
            if (ev.end) endStr = formatLocalDateInput(new Date(ev.end));
          }

          return {
            id: String(ev?.id || ""),
            type,
            status: String(ev?.extendedProps?.status || ""),
            title: String(ev?.title || "Calendar Item"),
            start: startStr,
            end: endStr,
            allDay: !!ev?.allDay,
            notes: String(ev?.extendedProps?.notes || ev?.extendedProps?.topic || ""),
            location: String(
              ev?.extendedProps?.venue ||
              ev?.extendedProps?.address ||
              ev?.extendedProps?.withWhom ||
              ""
            ),
            isPrompt: !!ev?.extendedProps?.isPrompt,
          };
        })
        .filter((item) => item && item.id && item.start && !item.isPrompt && !isCancelledStatus(item.status));

      const fingerprint = JSON.stringify(
        items.map((item) => `${item.type}|${item.id}|${item.start}|${item.end || ""}|${item.title}`)
      );

      if (fingerprint === lastSyncedFingerprintRef.current) return;

      try {
        await API.post("/auth/google/sync-visible", { items });
        lastSyncedFingerprintRef.current = fingerprint;
      } catch (err) {
        console.error("Google visible sync failed:", err);
      }
    }, 700);

    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, [googleSync.connected, loading, filteredEvents]);

  const hiddenCount = CATEGORIES.length - activeFilters.length;

  const handleEventClick = (info) => {
    info.jsEvent.stopPropagation();
    setDayMenu(null);
    const rect = info.el.getBoundingClientRect();
    let x = rect.left + rect.width / 2 - 200;
    let y = rect.bottom + 8;
    const maxPopoverHeight = Math.floor(window.innerHeight * 0.85);
    x = Math.max(8, Math.min(x, window.innerWidth - 420));
    y = Math.max(8, Math.min(y, window.innerHeight - maxPopoverHeight - 8));
    setPopover({ event: info.event, x, y });
    setEditingReminder(false);
    setEditingDailyClosing(false);

    if (info.event.extendedProps?.type === "meeting") {
      const d = new Date(info.event.startStr || info.event.start);
      if (!Number.isNaN(d.getTime())) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, "0");
        const da = String(d.getDate()).padStart(2, "0");
        setEditDate(`${yr}-${mo}-${da}`);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        setEditTime(`${hh}:${mm}`);
      }
    }

    setDailyClosingNotesDraft(String(info.event.extendedProps?.notes || ""));
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

  const openDayActionMenu = (info) => {
    const clickedDate = formatLocalDateInput(info.date);
    const rect = info.dayEl?.getBoundingClientRect?.();
    const panelWidth = 220;
    const x = Math.max(8, Math.min((rect?.left || 16) + 12, window.innerWidth - panelWidth - 8));
    const y = Math.max(8, Math.min((rect?.top || 16) + 32, window.innerHeight - 220));
    setPopover(null);
    setDayMenu({ x, y, selectedDate: clickedDate });
  };

  const navigateWithDate = (kind) => {
    if (!dayMenu?.selectedDate) return;
    const selectedDate = dayMenu.selectedDate;
    setDayMenu(null);
    if (kind === "daily_closing" && !isAdmin) {
      navigate("/daily-closing/form", { state: { selectedDate } });
      return;
    }
    if (kind === "meeting") {
      navigate(`/followups/add?date=${selectedDate}`, { state: { selectedDate } });
      return;
    }
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

      const eventType = String(popover?.event?.extendedProps?.type || "").toLowerCase();

      let nextStartIso = popover.event.startStr;

      if (eventType === "meeting") {
        const payload = {
          reminderEnabled,
          reminderChoice,
          reminderOptions: normalizedOptions,
        };

        const dueAt = new Date(`${editDate}T${editTime}:00`);
        if (!Number.isNaN(dueAt.getTime())) {
          payload.dueDateTime = dueAt.toISOString();
          nextStartIso = dueAt.toISOString();
        }

        await API.put(`/followups/${popover.event.id}`, payload);
      } else if (eventType === "event_expo") {
        const sourceId = String(popover?.event?.extendedProps?.sourceId || "").trim();
        if (sourceId) {
          const reminderStore = readExpoReminderStore();
          reminderStore[sourceId] = {
            reminderChoice,
            reminderOptions: normalizedOptions,
          };
          writeExpoReminderStore(reminderStore);
        }
      }

      setEvents((prev) =>
        prev.map((ev) =>
          ev.id !== popover.event.id
            ? ev
            : {
              ...ev,
              start: nextStartIso,
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
              startStr: nextStartIso,
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

      handleSuccess("Updated successfully");
      setEditingReminder(false);
    } catch (err) {
      console.error("Update failed:", err);
      handleError(err?.response?.data?.errors?.[0] || err?.response?.data?.message || err?.message || "Failed to save");
    } finally {
      setSavingReminder(false);
    }
  };

  const openCancelModal = () => {
    if (!popover?.event?.id) return;
    setCancelModal({
      open: true,
      eventId: String(popover.event.id),
      itemType: "meeting",
      title: popover.event.title || "",
      reason: "",
      error: "",
      saving: false,
    });
  };

  const closeCancelModal = () => {
    setCancelModal({
      open: false,
      eventId: "",
      itemType: "meeting",
      title: "",
      reason: "",
      error: "",
      saving: false,
    });
  };

  const cancelMeeting = async () => {
    if (!cancelModal?.eventId) return;
    const reason = String(cancelModal.reason || "").trim();
    if (reason.length < 3) {
      setCancelModal((prev) => ({
        ...prev,
        error: "Cancellation reason must be at least 3 characters.",
      }));
      return;
    }
    setCancelModal((prev) => ({ ...prev, saving: true, error: "" }));
    try {
      await API.put(`/followups/${cancelModal.eventId}/status`, {
        status: "cancelled",
        cancelReason: reason,
        notes: reason,
      });
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id !== cancelModal.eventId
            ? ev
            : {
                ...ev,
                backgroundColor: CANCELLED_COLOR,
                borderColor: CANCELLED_COLOR,
                extendedProps: {
                  ...ev.extendedProps,
                  status: "cancelled",
                  cancelReason: reason,
                  notes: reason,
                },
              }
        )
      );
      setPopover(null);
      setEditingReminder(false);
      closeCancelModal();
      handleSuccess("Meeting cancelled");
    } catch (err) {
      console.error("Cancel meeting failed:", err);
      setCancelModal((prev) => ({
        ...prev,
        saving: false,
        error: err?.response?.data?.message || "Failed to cancel meeting",
      }));
      handleError(err?.response?.data?.message || "Failed to cancel meeting");
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

  const saveDailyClosingInline = async () => {
    if (!popover?.event) return;
    const text = String(dailyClosingNotesDraft || "").trim();
    if (!text) return;

    const startDate = popover.event?.startStr ? new Date(popover.event.startStr) : new Date();
    if (Number.isNaN(startDate.getTime())) return;

    setSavingDailyClosing(true);
    try {
      await API.post("/daily-closing/submit", {
        selectedDate: formatLocalDateInput(startDate),
        keyHighlights: text,
      });
      await loadCalendarData();
      setPopover((prev) =>
        prev
          ? {
            ...prev,
            event: {
              ...prev.event,
              extendedProps: {
                ...prev.event.extendedProps,
                notes: text,
                isPrompt: false,
              },
            },
          }
          : prev
      );
      setEditingDailyClosing(false);
    } catch (err) {
      console.error("Daily closing inline save failed:", err);
    } finally {
      setSavingDailyClosing(false);
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
            dateClick={openDayActionMenu}
            eventTimeFormat={{
              hour: "2-digit",
              minute: "2-digit",
              meridiem: "lowercase",
            }}
            eventContent={(arg) => {
              const chipColor = arg.event.backgroundColor || "#3c4043";
              const isEventExpo = arg.event.extendedProps?.type === "event_expo";
              const isDaily = arg.event.extendedProps?.type === "daily_closing";
              const isCancelled = isCancelledStatus(arg.event.extendedProps?.status);

              const titleText = (arg.event.extendedProps?.type === "meeting" && arg.event.extendedProps?.withWhom)
                ? arg.event.extendedProps.withWhom
                : arg.event.title;

              return (
                <div
                  className={`cal-event-text ${isCancelled ? "is-cancelled" : ""}`}
                  style={{ backgroundColor: chipColor, color: "#ffffff" }}
                >
                  {arg.timeText && !isEventExpo && !isDaily && (
                    <span className="cal-ev-time">{arg.timeText}</span>
                  )}
                  <span className="cal-ev-title">{titleText}</span>
                </div>
              );
            }}
          />
          {loading && <div className="cal-loading">Loading calendar...</div>}
        </div>

        <div className="calendar-right-panel">
          <div className="add-icon-list">
            {CATEGORIES.filter((key) => {
              if (key === "event_expo") return false;
              if (isAdmin && key === "daily_closing") return false;
              return true;
            }).map((key) => (
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

      {dayMenu && (
        <div
          ref={dayMenuRef}
          className="cal-day-menu"
          style={{ left: dayMenu.x, top: dayMenu.y }}
        >
          <div className="cal-day-menu-title">Add for {dayMenu.selectedDate}</div>
          {!isAdmin ? (
            <button className="cal-day-menu-item" onClick={() => navigateWithDate("daily_closing")}>
              Add Daily Task
            </button>
          ) : null}
          <button className="cal-day-menu-item" onClick={() => navigateWithDate("meeting")}>
            Schedule Meeting
          </button>

        </div>
      )}

      {popover && (() => {
        const ev = popover.event;
        const props = ev.extendedProps || {};
        const dateStr = formatEventDate(ev.startStr, ev.endStr);
        const isCancelled = isCancelledStatus(props.status);

        return (
          <div
            ref={popoverRef}
            className="event-popover"
            style={{ position: "fixed", left: popover.x, top: popover.y }}
          >
            <div className="ep-header">
              <div className="ep-actions">
                {props.type === "meeting" && (
                  <>
                    <button
                      className="ep-action-btn ep-edit"
                      title="Edit meeting & reminder"
                      disabled={isCancelled}
                      onClick={() => setEditingReminder((prev) => !prev)}
                    >
                      <FaPenToSquare />
                    </button>
                    <button
                      className="ep-action-btn ep-cancel"
                      title={isCancelled ? "Meeting already cancelled" : "Cancel meeting"}
                      disabled={isCancelled}
                      onClick={openCancelModal}
                    >
                      <FaBan />
                    </button>
                  </>
                )}
                {props.type === "event_expo" && (
                  <button
                    className="ep-action-btn ep-edit"
                    title="Edit reminder"
                    onClick={() => setEditingReminder((prev) => !prev)}
                  >
                    <FaPenToSquare />
                  </button>
                )}
                {props.type === "daily_closing" && (
                  <>
                    <button
                      className="ep-action-btn ep-edit"
                      title="View daily closing report"
                      onClick={() => {
                        setPopover(null);
                        const reportDate = ev.startStr ? formatLocalDateInput(new Date(ev.startStr)) : "";
                        navigate(`/daily-closing/report${reportDate ? `?date=${reportDate}` : ""}`);
                      }}
                    >
                      <FaEye />
                    </button>
                    <button
                      className="ep-action-btn ep-edit"
                      title="Edit daily closing"
                      onClick={() => {
                        setEditingDailyClosing((prev) => !prev);
                        setDailyClosingNotesDraft(String(props.notes || ""));
                      }}
                    >
                      <FaPenToSquare />
                    </button>
                  </>
                )}
                <button className="ep-action-btn ep-close" title="Close" onClick={() => setPopover(null)}>
                  <FaXmark />
                </button>
              </div>
            </div>

            <div className="ep-title-row">
              <span className="ep-color-dot" style={{ background: ev.backgroundColor || CATEGORY_COLORS[props.type] || CATEGORY_COLORS.meeting }} />
              <div>
                <div className="ep-title">
                  {props.type === "meeting" && props.withWhom ? `${props.withWhom}` : ev.title}
                </div>
                {editingReminder && props.type === "meeting" && !isCancelled ? (
                  <div className="ep-date-edit" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} disabled={savingReminder} style={{ padding: "0 4px" }} />
                    <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} disabled={savingReminder} style={{ padding: "0 4px" }} />
                  </div>
                ) : (
                  <div className="ep-date">{dateStr}</div>
                )}
              </div>
            </div>

            <div className="ep-detail-row">
              <FaCalendarCheck className="ep-detail-icon" />
              <span>{CATEGORY_LABELS[props.type] || CATEGORY_LABELS.meeting}</span>
            </div>
            <div className="ep-detail-row">
              <FaUser className="ep-detail-icon" />
              <span className={`ep-status-pill ${isCancelled ? "is-cancelled" : ""}`}>
                Status: {isCancelled ? "Cancelled" : (props.status || "scheduled")}
              </span>
            </div>
            {props.type === "meeting" && (
              <>
                <div className="ep-detail-row">
                  <FaList className="ep-detail-icon" />
                  <span>Topic: {props.topic || "-"}</span>
                </div>

                <div className="ep-detail-row">
                  <FaList className="ep-detail-icon" />
                  <span>Type: {props.meetingType || "other"}</span>
                </div>
                <div className="ep-detail-row">
                  <FaBolt className="ep-detail-icon" />
                  <span>Priority: {props.priority || "Medium"}</span>
                </div>
                {isCancelled && (
                  <div className="ep-detail-row">
                    <FaList className="ep-detail-icon" />
                    <span>Cancellation Reason: {props.cancelReason || props.notes || "-"}</span>
                  </div>
                )}
                <div className="ep-detail-row ep-reminder-row">
                  <FaBell className="ep-detail-icon" />
                  {!editingReminder || isCancelled ? (
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
              </>
            )}
            {props.type === "event_expo" && (
              <>
                <div className="ep-detail-row">
                  <FaList className="ep-detail-icon" />
                  <span>Venue: {props.venue || "-"}</span>
                </div>
                <div className="ep-detail-row">
                  <FaBolt className="ep-detail-icon" />
                  <span>Fee: {props.registrationFee ?? 0}</span>
                </div>
                <div className="ep-detail-row">
                  <FaList className="ep-detail-icon" />
                  <span>Details: {props.notes || "-"}</span>
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
                            <div className="ep-notify-row" key={`expo-notify-row-${idx}`}>
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
              </>
            )}
            {props.type === "daily_closing" && (
              <>
                <div className="ep-detail-row">
                  <FaList className="ep-detail-icon" />
                  {!editingDailyClosing ? (
                    <span>{props.notes || "No details added yet."}</span>
                  ) : (
                    <div className="ep-reminder-edit">
                      <textarea
                        className="ep-daily-textarea"
                        value={dailyClosingNotesDraft}
                        onChange={(e) => setDailyClosingNotesDraft(e.target.value)}
                        placeholder="Enter key highlights..."
                        disabled={savingDailyClosing}
                      />
                      <button
                        className="ep-save-btn"
                        onClick={saveDailyClosingInline}
                        disabled={savingDailyClosing || !String(dailyClosingNotesDraft || "").trim()}
                      >
                        {savingDailyClosing ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="ep-detail-row">
                  <FaBell className="ep-detail-icon" />
                  <span>Reminder: No reminder for daily closing entries.</span>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {cancelModal.open && (
        <div className="cal-modal-overlay" role="dialog" aria-modal="true" aria-label="Cancel meeting">
          <div className="cal-modal-card">
            <div className="cal-modal-head">
              <div>
                <h3>Cancel Meeting?</h3>
                <p>
                  Are you sure you want to cancel this meeting
                  {cancelModal.title ? ` "${cancelModal.title}"` : ""}?
                </p>
              </div>
              <button
                className="cal-modal-close"
                type="button"
                onClick={closeCancelModal}
                disabled={cancelModal.saving}
              >
                <FaXmark />
              </button>
            </div>
            <label className="cal-modal-field">
              <span>Cancellation Reason</span>
              <textarea
                value={cancelModal.reason}
                onChange={(e) =>
                  setCancelModal((prev) => ({
                    ...prev,
                    reason: e.target.value,
                    error: "",
                  }))
                }
                placeholder="Add a short reason for cancellation"
                disabled={cancelModal.saving}
              />
            </label>
            {cancelModal.error ? <div className="cal-modal-error">{cancelModal.error}</div> : null}
            <div className="cal-modal-actions">
              <button
                className="cal-modal-btn secondary"
                type="button"
                onClick={closeCancelModal}
                disabled={cancelModal.saving}
              >
                Keep Meeting
              </button>
              <button
                className="cal-modal-btn danger"
                type="button"
                onClick={cancelMeeting}
                disabled={cancelModal.saving}
              >
                {cancelModal.saving ? "Cancelling..." : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
