import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Event.css";

const DEMO_EVENT = {
  _id: "demo-event-1",
  name: "Renewable Energy India Expo 2026",
  industry: { _id: "demo-industry", name: "Renewable Energy" },
  venue: "India Expo Centre",
  location: { city: "Greater Noida" },
  startDate: "2026-03-15T00:00:00.000Z",
  endDate: "2026-03-17T00:00:00.000Z",
  registrationFee: 25000,
  attendeesCount: 45000,
  exhibitorsCount: 800,
  aiRelevanceScore: 95,
  aiRecommendation:
    "Based on recent Solar EPC wins, this event has strong lead potential and high ROI likelihood.",
  priorityTag: "high",
  status: "upcoming",
  websiteUrl: "https://www.reiindia.com",
  description:
    "India's largest renewable energy exhibition with high potential for solar EPC and energy-tech partnerships.",
  isRegistered: false,
  isAttending: false
};

const DUMMY_AI_EVENT = {
  _id: "dummy-ai-upcoming-event-1",
  name: "AI Suggested: Smart Factory India Expo 2026",
  industry: { _id: "dummy-ai-industry", name: "Manufacturing" },
  venue: "BIEC",
  location: { city: "Bengaluru", state: "Karnataka" },
  startDate: "2026-04-18T00:00:00.000Z",
  endDate: "2026-04-20T00:00:00.000Z",
  registrationFee: 12000,
  attendeesCount: 18000,
  exhibitorsCount: 420,
  aiRelevanceScore: 88,
  aiRecommendation:
    "AI found this event based on your recent industrial automation leads. Strong fit for manufacturing pipeline growth.",
  source: { name: "AI Suggested" },
  priorityTag: "high",
  status: "upcoming",
  websiteUrl: "",
  description:
    "Upcoming manufacturing and Industry 4.0 expo with high potential for solution-based B2B conversations.",
  isRegistered: false,
  isAttending: false
};

const formatDateRange = (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
    return "Date TBA";
  }

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startFmt = start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: sameMonth ? undefined : "numeric" });
  const endFmt = end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `${startFmt} - ${endFmt}`;
};

const getDurationText = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "N/A";
  const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
  return `${days} day${days > 1 ? "s" : ""}`;
};

const getLocationText = (eventItem) => {
  const city = eventItem.location?.city;
  const state = eventItem.location?.State || eventItem.location?.state;
  return [eventItem.venue, city, state].filter(Boolean).join(", ") || "Location TBA";
};

const contains = (value, query) => String(value || "").toLowerCase().includes(query);

const EventExpo = () => {
  const navigate = useNavigate();
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const isAdminOrManager = roleName === "admin" || roleName === "manager";
  const isRestrictedUser = !isAdminOrManager;
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({
    upcomingEvents: 0,
    registeredEvents: 0,
    attendingEvents: 0,
    avgAiScore: 0,
    lastUpdatedAt: null
  });
  const [industryFilter, setIndustryFilter] = useState("all");
  const [locationQuery, setLocationQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demoAttending, setDemoAttending] = useState(false);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError("");
      const [eventsRes, summaryRes] = await Promise.all([
        API.get("/events"),
        API.get("/events/summary")
      ]);
      setEvents(Array.isArray(eventsRes.data) ? eventsRes.data : []);
      setSummary(summaryRes.data || {});
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to load events";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const openAddEventPage = () => {
    navigate("/events/new");
  };

  const openRegistrationForm = (eventItem) => {
    const isDemoEvent = eventItem._id === DEMO_EVENT._id;
    navigate("/events/register", {
      state: {
        eventId: isDemoEvent ? "" : eventItem._id,
        eventName: eventItem.name,
        eventLocation: getLocationText(eventItem),
        eventDates: formatDateRange(eventItem.startDate, eventItem.endDate),
        registrationFee: String(eventItem.registrationFee || 0),
        isRegistered: Boolean(eventItem.isRegistered)
      }
    });
  };

  const toggleAttending = async (eventId, currentlyAttending) => {
    if (eventId === DEMO_EVENT._id) {
      setDemoAttending(!currentlyAttending);
      return;
    }

    try {
      const { data } = await API.put(`/events/${eventId}/attending`, {
        attending: !currentlyAttending
      });
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      setSummary((prev) => ({
        ...prev,
        attendingEvents: Math.max(0, Number(prev.attendingEvents || 0) + (data.isAttending ? 1 : -1))
      }));
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update attending status");
    }
  };

  const industryOptions = useMemo(() => {
    const map = new Map();
    events.forEach((item) => {
      const id = item.industry?._id;
      const name = item.industry?.name;
      if (id && name) map.set(id, name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [events]);

  const locationOptions = useMemo(() => {
    const set = new Set();
    events.forEach((item) => {
      if (item.location?.city) set.add(item.location.city);
      if (item.location?.State) set.add(item.location.State);
      if (item.location?.state) set.add(item.location.state);
      if (item.location?.city && (item.location?.State || item.location?.state)) {
        set.add(`${item.location.city}, ${item.location?.State || item.location?.state}`);
      }
      if (item.venue) set.add(item.venue);
      if (item.address) set.add(item.address);
      if (item.name) set.add(item.name);
    });
    return Array.from(set);
  }, [events]);

  const filteredEvents = useMemo(() => {
    const baseEvents = events.length
      ? events
      : isRestrictedUser
        ? []
        : [{ ...DEMO_EVENT, isAttending: demoAttending }];

    const hasAiEvent = baseEvents.some((item) =>
      String(item?.source?.name || "").toLowerCase().includes("ai") ||
      Boolean(String(item?.aiRecommendation || "").trim())
    );
    const eventsToFilter =
      !isRestrictedUser && !hasAiEvent
        ? [...baseEvents, DUMMY_AI_EVENT]
        : baseEvents;

    const query = locationQuery.trim().toLowerCase();
    const now = new Date();

    return eventsToFilter.filter((eventItem) => {
      const matchesIndustry = industryFilter === "all" || eventItem.industry?._id === industryFilter;
      const matchesLocation =
        !query ||
        contains(eventItem.location?.city, query) ||
        contains(eventItem.location?.State, query) ||
        contains(eventItem.location?.state, query) ||
        contains(eventItem.venue, query) ||
        contains(eventItem.address, query) ||
        contains(eventItem.name, query);

      let matchesQuick = true;
      if (quickFilter === "high-priority") matchesQuick = eventItem.priorityTag === "high" || eventItem.priorityTag === "strategic";
      if (quickFilter === "registered") matchesQuick = Boolean(eventItem.isRegistered);
      if (quickFilter === "this-month") {
        const start = new Date(eventItem.startDate);
        matchesQuick =
          start.getMonth() === now.getMonth() &&
          start.getFullYear() === now.getFullYear();
      }
      if (quickFilter === "near-me") matchesQuick = true;

      return matchesIndustry && matchesLocation && matchesQuick;
    });
  }, [events, industryFilter, locationQuery, quickFilter, demoAttending, isRestrictedUser]);

  const registeredCount = Number(summary.registeredEvents || 0);
  const attendingCount = Number(summary.attendingEvents || 0);
  const avgAiScore = Number(summary.avgAiScore || 0);
  const upcomingCount = Number(summary.upcomingEvents || 0) || (events.length ? events.length : 0);
  const invitationCount = upcomingCount;
  const pendingInvitationCount = Math.max(0, invitationCount - attendingCount);
  const lastUpdatedLabel = summary.lastUpdatedAt
    ? new Date(summary.lastUpdatedAt).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
    : "N/A";

  return (
    <div className="event-page">
      <div className="event-page-header">
        <div>
          <h2>Events & Expos</h2>
          <p>Track opportunities, register teams, and manage upcoming expos.</p>
        </div>
      </div>

      <div className={`event-summary-cards ${isRestrictedUser ? "event-summary-cards-user" : ""}`}>
        {isRestrictedUser ? (
          <>
            <div className="event-card event-card-accent-blue">
              <h4>Total Invitations</h4>
              <h2>{invitationCount}</h2>
              <p>Events assigned to you</p>
            </div>

            <div className="event-card event-card-accent-green">
              <h4>Attending</h4>
              <h2>{attendingCount}</h2>
              <p>{pendingInvitationCount} pending response</p>
            </div>

            <div className="event-card event-card-accent-purple">
              <h4>Last Updated</h4>
              <h2>{loading ? "..." : "Live"}</h2>
              <p>{lastUpdatedLabel}</p>
            </div>
          </>
        ) : (
          <>
            <div className="event-card event-card-accent-blue">
              <h4>Upcoming Events</h4>
              <h2>{upcomingCount}</h2>
              <p>Available in your pipeline</p>
            </div>

            <div className="event-card event-card-accent-green">
              <h4>Registered</h4>
              <h2>{registeredCount}</h2>
              <p>{attendingCount} attending confirmed</p>
            </div>

            <div className="event-card event-card-accent-orange">
              <h4>Avg AI Score</h4>
              <h2>{avgAiScore.toFixed(1)}</h2>
              <p>Across tracked events</p>
            </div>

            <div className="event-card event-card-accent-purple">
              <h4>Last Updated</h4>
              <h2>{loading ? "..." : "Live"}</h2>
              <p>{lastUpdatedLabel}</p>
            </div>
          </>
        )}
      </div>

      <div className="event-section">
        <div className="event-section-header">
          <div className="event-section-title-wrap">
            <h3>Upcoming Events & Expos</h3>
          </div>

          <div className="event-dropdowns">
            <select value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)}>
              <option value="all">All Events</option>
              <option value="near-me">Near Me</option>
              <option value="high-priority">High Priority</option>
              <option value="this-month">This Month</option>
              <option value="registered">Registered</option>
            </select>

            <select value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)}>
              <option value="all">All Industries</option>
              {industryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>

            <input
              type="search"
              list="event-city-list"
              placeholder="Search location (city/state/venue/event)"
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
            />

            <button className="add-event-btn-section" onClick={openAddEventPage}>
              + Add Event
            </button>
            <datalist id="event-city-list">
              {locationOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
        </div>

        {loading && (
          <div className="event-empty-state">
            <h4>Loading events...</h4>
            <p>Please wait while we fetch your event data.</p>
          </div>
        )}

        {!loading && error && (
          <div className="event-empty-state">
            <h4>Could not load events</h4>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && filteredEvents.length === 0 && (
          <div className="event-empty-state">
            <h4>No events found</h4>
            <p>Try another city, venue, or industry filter.</p>
          </div>
        )}

        {!loading && !error && filteredEvents.map((eventItem) => {
          const score = Number(eventItem.aiRelevanceScore || 0);
          const scoreLabel = score >= 90 ? "Must Attend" : score >= 70 ? "Strong Fit" : "Evaluate";
          const aiRecommendationText = String(eventItem.aiRecommendation || "").trim();
          const isAiSuggested =
            String(eventItem.source?.name || "").toLowerCase().includes("ai") ||
            Boolean(aiRecommendationText);
          const isAttending = Boolean(eventItem.isAttending);
          const attendingUsers = Array.isArray(eventItem.attendedBy)
            ? eventItem.attendedBy
              .map((user) => user?.name || user?.email || "")
              .filter(Boolean)
            : [];

          return (
            <div className="event-item" key={eventItem._id}>
              <div className="event-left">
                <div className="event-title-row">
                  <h4>{eventItem.name}</h4>
                  <span className="score-badge">{score ? `${score} - ${scoreLabel}` : "AI Score Pending"}</span>
                </div>

                <p className="event-meta">{getLocationText(eventItem)}</p>
                <p className="event-meta">{formatDateRange(eventItem.startDate, eventItem.endDate)} ({getDurationText(eventItem.startDate, eventItem.endDate)})</p>

                <p>{eventItem.description || "No description available."}</p>

                <div className="event-tags">
                  <span>{Number(eventItem.attendeesCount || 0).toLocaleString("en-IN")} attendees</span>
                  <span>{Number(eventItem.exhibitorsCount || 0).toLocaleString("en-IN")} exhibitors</span>
                  <span>{eventItem.industry?.name || "Industry N/A"}</span>
                  {isAiSuggested && <span className="ai-tag">AI Found</span>}
                </div>

                {isAiSuggested && (
                  <div className="ai-recommendation">
                    AI Recommendation: {aiRecommendationText || "No AI recommendation available yet."}
                  </div>
                )}

                {attendingUsers.length > 0 && (
                  <div className="event-attendance-meta">
                    <strong>Attending:</strong>{" "}
                    {attendingUsers.join(", ")}
                  </div>
                )}

                <div className="event-actions">
                  {!isRestrictedUser && (
                    <button
                      className={`primary ${eventItem.isRegistered ? "registered-btn" : ""}`}
                      onClick={() => openRegistrationForm(eventItem)}
                    >
                      {eventItem.isRegistered ? "Already Registered" : "Register & Attend"}
                    </button>
                  )}
                  <button
                    className={`attend-btn ${isAttending ? "secondary-active" : ""}`}
                    onClick={() => toggleAttending(eventItem._id, isAttending)}
                  >
                    {isAttending ? "Attending" : "Mark Attending"}
                  </button>
                  <button
                    onClick={() => eventItem.websiteUrl && window.open(eventItem.websiteUrl, "_blank", "noopener,noreferrer")}
                    disabled={!eventItem.websiteUrl}
                  >
                    Visit Website
                  </button>
                </div>
              </div>

              <div className="event-right">
                <h3>Rs. {Number(eventItem.registrationFee || 0).toLocaleString("en-IN")}</h3>
                <p>Registration Fee</p>
              </div>
            </div>
          );
        })}
      </div>

      {!isRestrictedUser && (
        <div className="event-analytics">
          <h3>Event Performance Analytics</h3>

          <div className="analytics-cards">
            <div className="analytics-card">
              <h4>Registered Events</h4>
              <h2>{registeredCount}</h2>
              <p>Based on your logged-in user activity</p>
            </div>

            <div className="analytics-card">
              <h4>Attending Events</h4>
              <h2>{attendingCount}</h2>
              <p>Marked for participation</p>
            </div>

            <div className="analytics-card">
              <h4>Avg AI Event Score</h4>
              <h2>{avgAiScore.toFixed(1)}</h2>
              <p>AI relevance from saved events</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventExpo;
