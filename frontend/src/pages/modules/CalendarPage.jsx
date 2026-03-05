import React, { useRef, useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import interactionPlugin from "@fullcalendar/interaction";

import meetingImg from "../../assets/calendar/meeting.png";
import dailyImg from "../../assets/calendar/daily-tasks.png";
import expoImg from "../../assets/calendar/team-building.png";

import "./styles/CalendarPage.css";

/* ─── constants ─── */
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

/* ─── sample events ─── */
const initialEvents = [
    {
        id: "1",
        title: "Meeting: Test Marketing",
        start: "2026-03-12T10:00:00",
        end: "2026-03-12T11:00:00",
        extendedProps: { type: "meeting", description: "Discuss Q2 marketing campaigns", priority: "High", reminder: "30 minutes before", organizer: "Dipali Gode" },
        backgroundColor: CATEGORY_COLORS.meeting, borderColor: CATEGORY_COLORS.meeting,
    },
    {
        id: "2",
        title: "Daily Closing",
        start: "2026-03-07T17:00:00",
        end: "2026-03-07T17:30:00",
        extendedProps: { type: "daily_closing", description: "End-of-day sales summary", priority: "Medium", reminder: "1 hour before", organizer: "Dipali Gode" },
        backgroundColor: CATEGORY_COLORS.daily_closing, borderColor: CATEGORY_COLORS.daily_closing,
    },
    {
        id: "3",
        title: "Expo: SaaS Global",
        start: "2026-03-24",
        end: "2026-03-26",
        extendedProps: { type: "event_expo", description: "Annual SaaS industry expo", priority: "Low", reminder: "1 day before", organizer: "Dipali Gode" },
        backgroundColor: CATEGORY_COLORS.event_expo, borderColor: CATEGORY_COLORS.event_expo,
    },
];

function formatEventDate(start, end) {
    if (!start) return "";
    const opts = { weekday: "long", month: "long", day: "numeric" };
    const startDate = new Date(start);
    const dateStr = startDate.toLocaleDateString(undefined, opts);
    if (!end) return dateStr;
    const startTime = startDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const endDate = new Date(end);
    const endTime = endDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${dateStr} · ${startTime} – ${endTime}`;
}

/* ═══════════════════════════════════════════════════════════ */
export default function CalendarPage() {
    const calendarRef = useRef(null);
    const popoverRef = useRef(null);
    const filterBtnRef = useRef(null);
    const filterDropRef = useRef(null);

    const [currentView, setCurrentView] = useState("dayGridMonth");
    const [currentTitle, setCurrentTitle] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilters, setActiveFilters] = useState([...CATEGORIES]);
    const [popover, setPopover] = useState(null);
    const [filterOpen, setFilterOpen] = useState(false);

    /* toggle category filter */
    const toggleFilter = (type) => {
        setActiveFilters(prev =>
            prev.includes(type) ? prev.filter(f => f !== type) : [...prev, type]
        );
    };

    /* nav helpers */
    const nav = (fn) => () => {
        const api = calendarRef.current.getApi();
        api[fn]();
        setCurrentTitle(api.view.title);
    };

    const handleViewChange = (e) => {
        const v = e.target.value;
        setCurrentView(v);
        const api = calendarRef.current.getApi();
        api.changeView(v);
        setCurrentTitle(api.view.title);
    };

    /* event click → popover */
    const handleEventClick = (info) => {
        info.jsEvent.stopPropagation();
        const rect = info.el.getBoundingClientRect();
        let x = rect.left + rect.width / 2 - 180;
        let y = rect.bottom + 8;
        x = Math.max(8, Math.min(x, window.innerWidth - 380));
        y = Math.min(y, window.innerHeight - 340);
        setPopover({ event: info.event, x, y });
    };

    /* close popover on outside click */
    useEffect(() => {
        const h = (e) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) setPopover(null);
            if (filterDropRef.current && !filterDropRef.current.contains(e.target) &&
                filterBtnRef.current && !filterBtnRef.current.contains(e.target)) {
                setFilterOpen(false);
            }
        };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, []);

    /* filtered events */
    const filteredEvents = initialEvents.filter(ev =>
        ev.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        activeFilters.includes(ev.extendedProps.type)
    );

    /* active filter count badge */
    const hiddenCount = CATEGORIES.length - activeFilters.length;

    return (
        <div className="calendar-layout">

            {/* ─── Top bar ─── */}
            <div className="calendar-topbar">
                <div className="calendar-topbar-left">
                    <button className="cal-btn" onClick={nav("today")}>Today</button>
                    <button className="cal-icon-btn" onClick={nav("prev")}>&#8249;</button>
                    <button className="cal-icon-btn" onClick={nav("next")}>&#8250;</button>
                    <h2 className="calendar-title">{currentTitle}</h2>
                </div>

                <div className="calendar-topbar-right">
                    <div className="cal-search-box">
                        <span className="search-icon"><i className="fa-solid fa-magnifying-glass" /></span>
                        <input
                            type="text"
                            placeholder="Search events..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* ── Filter dropdown button ── */}
                    <div className="filter-dropdown-wrapper">
                        <button
                            ref={filterBtnRef}
                            className={`cal-btn filter-toggle-btn ${filterOpen ? "active" : ""}`}
                            onClick={() => setFilterOpen(o => !o)}
                        >
                            <i className="fa-solid fa-filter" />
                            {" "}Filter
                            {hiddenCount > 0 && <span className="filter-badge">{hiddenCount}</span>}
                        </button>

                        {filterOpen && (
                            <div ref={filterDropRef} className="filter-dropdown">
                                {CATEGORIES.map(key => (
                                    <label key={key} className="filter-drop-row">
                                        <input
                                            type="checkbox"
                                            checked={activeFilters.includes(key)}
                                            onChange={() => toggleFilter(key)}
                                            style={{ accentColor: CATEGORY_COLORS[key] }}
                                        />
                                        <img src={CATEGORY_IMAGES[key]} alt="" className="filter-drop-img" />
                                        <span className="filter-drop-label" style={{ color: CATEGORY_COLORS[key] }}>{CATEGORY_LABELS[key]}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── View selector ── */}
                    <select className="cal-view-select" value={currentView} onChange={handleViewChange}>
                        <option value="timeGridDay">Day</option>
                        <option value="timeGridWeek">Week</option>
                        <option value="dayGridMonth">Month</option>
                        <option value="multiMonthYear">Year</option>
                        <option value="listWeek">Schedule</option>
                    </select>
                </div>
            </div>

            {/* ─── Body ─── */}
            <div className="calendar-body">

                {/* Main Calendar */}
                <div className="calendar-main">
                    <FullCalendar
                        ref={calendarRef}
                        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]}
                        initialView="dayGridMonth"
                        headerToolbar={false}
                        events={filteredEvents}
                        height="100%"
                        expandRows={true}
                        dayMaxEvents={true}
                        fixedWeekCount={false}
                        multiMonthMaxColumns={4}
                        datesSet={arg => setCurrentTitle(arg.view.title)}
                        eventClick={handleEventClick}
                        eventContent={(arg) => {
                            const color = arg.event.backgroundColor || '#3c4043';
                            const isAllDay = !arg.event.start || arg.event.allDay;
                            if (isAllDay) {
                                // All-day chip style (e.g. Expo bar)
                                return (
                                    <div className="cal-event-chip" style={{ background: color }}>
                                        {arg.event.title}
                                    </div>
                                );
                            }
                            // Timed event: colored text, no dot
                            const timeStr = arg.timeText;
                            return (
                                <div className="cal-event-text" style={{ color }}>
                                    <span className="cal-ev-time">{timeStr}</span>
                                    <span className="cal-ev-title">{arg.event.title}</span>
                                </div>
                            );
                        }}
                    />
                </div>

                {/* ─── Right Panel – icon-only add shortcuts ─── */}
                <div className="calendar-right-panel">
                    <div className="add-icon-list">
                        {CATEGORIES.map(key => (
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

            {/* ─── Event Detail Popover ─── */}
            {popover && (() => {
                const ev = popover.event;
                const props = ev.extendedProps;
                const color = CATEGORY_COLORS[props.type] || "#4285F4";
                const label = CATEGORY_LABELS[props.type] || "Event";
                const dateStr = formatEventDate(ev.startStr, ev.endStr);

                return (
                    <div ref={popoverRef} className="event-popover" style={{ position: "fixed", left: popover.x, top: popover.y }}>
                        <div className="ep-header">
                            <div className="ep-actions">
                                <button className="ep-action-btn ep-edit" title="Edit">   <i className="fa-solid fa-pen" />   </button>
                                <button className="ep-action-btn ep-delete" title="Cancel">  <i className="fa-solid fa-trash" />  </button>
                                <button className="ep-action-btn ep-close" title="Close" onClick={() => setPopover(null)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>

                        <div className="ep-title-row">
                            <span className="ep-color-dot" style={{ background: color }} />
                            <div>
                                <div className="ep-title">{ev.title}</div>
                                <div className="ep-date">{dateStr}</div>
                            </div>
                        </div>

                        <div className="ep-detail-row">
                            <img src={CATEGORY_IMAGES[props.type]} alt="" className="ep-img-icon" />
                            <span className="ep-detail-label">{label}</span>
                        </div>
                        {props.description && (
                            <div className="ep-detail-row">
                                <i className="fa-solid fa-align-left ep-detail-icon" />
                                <span>{props.description}</span>
                            </div>
                        )}
                        {props.priority && (
                            <div className="ep-detail-row">
                                <i className="fa-solid fa-bolt ep-detail-icon" />
                                <span>Priority: {props.priority}</span>
                            </div>
                        )}
                        {props.reminder && (
                            <div className="ep-detail-row">
                                <i className="fa-solid fa-bell ep-detail-icon" />
                                <span>{props.reminder}</span>
                            </div>
                        )}
                        {props.organizer && (
                            <div className="ep-detail-row">
                                <i className="fa-solid fa-user ep-detail-icon" />
                                <span>{props.organizer}</span>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}
