import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import ConfirmDialog from "../../components/ConfirmDialog";
import OutcomeForm from "../../components/OutcomeForm";
import "./styles/Event.css";
import "./eventsOutcome.css";

const NEAR_ME_RADIUS_KM = 120;

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

const buildEventSearchUrl = (eventItem) => {
  const startDate = eventItem.startDate
    ? new Date(eventItem.startDate).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    })
    : "";
  const address = String(eventItem.address || "").trim();
  const query = [
    eventItem.name,
    address,
    startDate,
  ]
    .filter(Boolean)
    .join(" ");

  if (!query.trim()) return "";
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
};

const contains = (value, query) => String(value || "").toLowerCase().includes(query);
const formatPriority = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Medium";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const formatFee = (amountValue, currencyValue) => {
  const amount = toOptionalNumber(amountValue);
  if (amount === null) return "N/A";
  if (amount <= 0) return "Free";

  const currency = String(currencyValue || "").trim().toUpperCase() || "INR";
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;

  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    })}`;
  }
};

const getDisplayRegistrationFee = (eventItem = {}) => {
  const amount = toOptionalNumber(eventItem.registrationFee);
  const sourceName = String(eventItem.source?.name || "").trim().toLowerCase();
  const currency = String(eventItem.registrationCurrency || "INR").trim().toUpperCase();
  if (sourceName === "meetup" && currency === "INR" && amount !== null && amount <= 5) {
    return 0;
  }
  return eventItem.registrationFee;
};

const formatCount = (value) => {
  const parsed = toOptionalNumber(value);
  if (parsed === null) return "N/A";
  return parsed.toLocaleString("en-IN");
};

const normalizeKeyText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ");

const normalizeDayKey = (dateValue) => {
  const parsed = dateValue ? new Date(dateValue) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const eventLocationIdentityKey = (eventItem) => {
  const city = normalizeKeyText(eventItem.location?.city);
  const state = normalizeKeyText(eventItem.location?.State || eventItem.location?.state);
  if (city || state) {
    return `${city || "na"}|${state || "na"}`;
  }
  return normalizeKeyText(eventItem.venue || eventItem.address);
};

const eventDedupKey = (eventItem) => {
  const signature = normalizeKeyText(eventItem.dedupeSignature);
  if (signature) return `signature:${signature}`;
  const explicit = normalizeKeyText(eventItem.externalIdentityKey);
  if (explicit) return `external:${explicit}`;
  const normalizedUrl = normalizeKeyText(eventItem.normalizedWebsiteUrl || eventItem.websiteUrl);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const sourceName = normalizeKeyText(eventItem.source?.name);
  const name = normalizeKeyText(eventItem.name);
  const location = eventLocationIdentityKey(eventItem);
  const day = normalizeDayKey(eventItem.startDate);
  return `fallback:${sourceName}|${name}|${day}|${location}`;
};

const eventWinnerScore = (eventItem) => {
  const aiScore = Number(eventItem.aiRelevanceScore || 0);
  const hasRoleComparison = eventItem?.roiRoleComparison ? 1 : 0;
  const hasPredictedRoi = toOptionalNumber(eventItem?.predictedROI) !== null ? 1 : 0;
  const registrationCount = Array.isArray(eventItem.registeredBy) ? eventItem.registeredBy.length : 0;
  const attendedCount = Array.isArray(eventItem.attendedBy) ? eventItem.attendedBy.length : 0;
  const interestedCount = Array.isArray(eventItem.interested) ? eventItem.interested.length : 0;
  const updatedAt = eventItem.updatedAt ? new Date(eventItem.updatedAt).getTime() : 0;
  return (
    (hasRoleComparison * 8000000000000) +
    (hasPredictedRoi * 4000000000000) +
    (aiScore * 1000) +
    (registrationCount * 100) +
    (attendedCount * 50) +
    (interestedCount * 20) +
    updatedAt
  );
};

const haversineDistanceKm = (latitudeA, longitudeA, latitudeB, longitudeB) => {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const latDistance = toRadians(latitudeB - latitudeA);
  const lonDistance = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) *
    Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const distanceFromUserKm = (eventItem, userCoordinates) => {
  if (!userCoordinates) return null;
  const latitude = toOptionalNumber(eventItem.latitude);
  const longitude = toOptionalNumber(eventItem.longitude);
  if (latitude === null || longitude === null) return null;
  return haversineDistanceKm(userCoordinates.latitude, userCoordinates.longitude, latitude, longitude);
};

const matchesLocationFallback = (eventItem, userPlace) => {
  if (!userPlace) return false;
  const blob = [
    eventItem.location?.city,
    eventItem.location?.State || eventItem.location?.state,
    eventItem.address,
    eventItem.venue,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const city = String(userPlace.city || "").trim().toLowerCase();
  const state = String(userPlace.state || "").trim().toLowerCase();
  if (city && blob.includes(city)) return true;
  if (state && blob.includes(state)) return true;
  return false;
};

const formatPredictedROI = (roiValue) => {
  const roi = Number(roiValue);
  if (!Number.isFinite(roi)) return "N/A";
  const percentValue = roi * 100;
  const fractionDigits = Math.abs(percentValue) >= 100 ? 0 : 1;
  return `${percentValue.toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  })}%`;
};

const normalizeRolePrediction = (value, fallbackRole) => {
  if (!value || typeof value !== "object") return null;
  const predictedROI = toOptionalNumber(value.predictedROI);
  if (predictedROI === null) return null;
  const confidence = toOptionalNumber(value.confidence);
  return {
    role: fallbackRole,
    predictedROI,
    expectedROIRange: String(value.expectedROIRange || "").trim(),
    confidence: confidence === null ? 0 : confidence,
  };
};

const getRoleComparison = (eventItem) => {
  const comparison = eventItem?.roiRoleComparison;
  let visitor = normalizeRolePrediction(comparison?.Visitor || comparison?.visitor, "Visitor");
  let exhibitor = normalizeRolePrediction(comparison?.Exhibitor || comparison?.exhibitor, "Exhibitor");

  const recommendedRole = String(
    comparison?.recommendedRole ||
    eventItem?.recommendedParticipationRole ||
    ""
  ).trim();
  const decisionSummary = String(
    comparison?.decisionSummary ||
    eventItem?.roiDecisionSummary ||
    ""
  ).trim();
  const basePredictedRoi = toOptionalNumber(eventItem?.predictedROI);
  const baseConfidence = toOptionalNumber(eventItem?.roiPredictionConfidence);
  const baseRange = String(eventItem?.expectedROIRange || "").trim();

  if (!visitor && !exhibitor && basePredictedRoi !== null) {
    const preferredRole = recommendedRole === "Exhibitor" ? "Exhibitor" : "Visitor";
    const visitorRoi = preferredRole === "Visitor" ? basePredictedRoi : (basePredictedRoi * 0.9);
    const exhibitorRoi = preferredRole === "Exhibitor" ? basePredictedRoi : (basePredictedRoi * 0.9);
    visitor = {
      role: "Visitor",
      predictedROI: Number(visitorRoi.toFixed(3)),
      expectedROIRange: baseRange,
      confidence: baseConfidence === null ? 0 : baseConfidence,
    };
    exhibitor = {
      role: "Exhibitor",
      predictedROI: Number(exhibitorRoi.toFixed(3)),
      expectedROIRange: baseRange,
      confidence: baseConfidence === null ? 0 : baseConfidence,
    };
  }

  if (visitor && !exhibitor) {
    exhibitor = {
      role: "Exhibitor",
      predictedROI: Number((visitor.predictedROI * 0.9).toFixed(3)),
      expectedROIRange: visitor.expectedROIRange,
      confidence: Math.max(0, Number(visitor.confidence || 0) - 5),
    };
  }
  if (exhibitor && !visitor) {
    visitor = {
      role: "Visitor",
      predictedROI: Number((exhibitor.predictedROI * 0.9).toFixed(3)),
      expectedROIRange: exhibitor.expectedROIRange,
      confidence: Math.max(0, Number(exhibitor.confidence || 0) - 5),
    };
  }
  if (!visitor && !exhibitor) return null;

  const inferredRole = String(comparison?.inferredRole || "").trim();
  const recommended =
    (recommendedRole === "Visitor" && visitor) ||
    (recommendedRole === "Exhibitor" && exhibitor) ||
    visitor ||
    exhibitor ||
    null;

  return {
    visitor,
    exhibitor,
    recommended,
    recommendedRole: recommended?.role || recommendedRole,
    decisionSummary,
    inferredRole,
  };
};

const EventExpo = () => {
  const navigate = useNavigate();
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const isAdmin = roleName === "admin";
  const isManager = roleName === "manager";
  const isAdminOrManager = roleName === "admin" || roleName === "manager";
  const isRestrictedUser = !isAdminOrManager;
  const canUsePendingInvitations = isRestrictedUser || isManager;
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({
    upcomingEvents: 0,
    registeredEvents: 0,
    attendingEvents: 0,
    missedPastEvents: 0,
    uninterestedPastEvents: 0,
    avgAiScore: 0,
    todayFetchedCount: 0,
    lastUpdatedAt: null,
    lastScraperRunAt: null,
    lastScraperNewEvents: 0,
    lastScraperUpdatedEvents: 0,
  });
  const [industryFilter, setIndustryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [locationQuery, setLocationQuery] = useState("");
  const [viewTab, setViewTab] = useState(() => (isRestrictedUser ? "registered" : "upcoming"));
  const [quickFilter, setQuickFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date_asc");
  const [userCoordinates, setUserCoordinates] = useState(null);
  const [userPlace, setUserPlace] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle");
  const [locationError, setLocationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const geocodeKeyRef = useRef("");

  // Modal states
  const [registrationConfirmOpen, setRegistrationConfirmOpen] = useState(false);
  const [registrationEventItem, setRegistrationEventItem] = useState(null);
  const [outcomeFormOpen, setOutcomeFormOpen] = useState(false);
  const [outcomeFormEventItem, setOutcomeFormEventItem] = useState(null);
  const [outcomeFormCallback, setOutcomeFormCallback] = useState(null);
  const [outcomeFormIsFromMarkAttended, setOutcomeFormIsFromMarkAttended] = useState(false);
  const [outcomeConfirmOpen, setOutcomeConfirmOpen] = useState(false);
  const [outcomeConfirmPayload, setOutcomeConfirmPayload] = useState(null);
  const [outcomeConfirmEventItem, setOutcomeConfirmEventItem] = useState(null);
  const [outcomeConfirmIsFromMarkAttended, setOutcomeConfirmIsFromMarkAttended] = useState(false);
  const [attendedConfirmOpen, setAttendedConfirmOpen] = useState(false);
  const [attendedConfirmEventItem, setAttendedConfirmEventItem] = useState(null);
  const [missedConfirmOpen, setMissedConfirmOpen] = useState(false);
  const [missedConfirmEventItem, setMissedConfirmEventItem] = useState(null);
  const [missedReasonInput, setMissedReasonInput] = useState("");
  const [missedReasonError, setMissedReasonError] = useState("");
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState("");
  const [rejectingInvitationId, setRejectingInvitationId] = useState("");

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

  useEffect(() => {
    if (isRestrictedUser && viewTab === "upcoming") {
      setViewTab("registered");
    }
  }, [isRestrictedUser, viewTab]);

  useEffect(() => {
    if (quickFilter !== "near-me") {
      setLocationStatus((prev) => (prev === "loading" ? "idle" : prev));
      return undefined;
    }
    if (!navigator?.geolocation) {
      setLocationStatus("unsupported");
      setLocationError("Location is not supported in this browser.");
      return undefined;
    }

    setLocationStatus("loading");
    const watcherId = navigator.geolocation.watchPosition(
      (position) => {
        setUserCoordinates({
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
        });
        setLocationStatus("ready");
        setLocationError("");
      },
      (geoError) => {
        setLocationStatus("error");
        setLocationError(geoError?.message || "Could not fetch your location.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watcherId);
    };
  }, [quickFilter]);

  useEffect(() => {
    if (quickFilter !== "near-me" || !userCoordinates) return;
    const key = `${userCoordinates.latitude.toFixed(3)},${userCoordinates.longitude.toFixed(3)}`;
    if (geocodeKeyRef.current === key) return;
    geocodeKeyRef.current = key;

    const controller = new AbortController();
    const lookup = async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(userCoordinates.latitude)}&lon=${encodeURIComponent(userCoordinates.longitude)}`,
          {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }
        );
        if (!response.ok) return;
        const payload = await response.json();
        const address = payload?.address || {};
        const locality = address.suburb || address.neighbourhood || address.city_district || address.village || "";
        const county = address.county || address.state_district || "";
        const fallbackCity = address.city || address.town || address.municipality || county || locality || "";
        const normalizedCounty = String(county || "").toLowerCase();
        const normalizedLocality = String(locality || "").toLowerCase();
        const city = (
          normalizedCounty.includes("pune") || normalizedLocality.includes("pune")
            ? "Pune"
            : fallbackCity
        );
        setUserPlace({
          city,
          locality,
          state: address.state || "",
          country: address.country || "",
        });
      } catch {
        // Best-effort reverse geocoding.
      }
    };

    lookup();
    return () => controller.abort();
  }, [quickFilter, userCoordinates]);

  const openAddEventPage = () => {
    if (!isAdminOrManager) return;
    navigate("/events/new");
  };

  const openRegistrationForm = (eventItem, options = {}) => {
    const { viewOnly = false } = options;
    if (viewOnly) {
      proceedToRegistration(eventItem, { viewOnly: true });
    } else {
      setRegistrationEventItem(eventItem);
      setRegistrationConfirmOpen(true);
    }
  };

  const proceedToRegistration = (eventItem, options = {}) => {
    const { viewOnly = false } = options;
    const registrationPayload = eventItem.myRegistration || (Array.isArray(eventItem.registrations) ? eventItem.registrations[0] : null);
    navigate("/events/register", {
      state: {
        eventId: eventItem._id,
        eventName: eventItem.name,
        eventLocation: getLocationText(eventItem),
        eventDates: formatDateRange(eventItem.startDate, eventItem.endDate),
        registrationFee: eventItem.registrationFee == null ? "" : String(eventItem.registrationFee),
        registrationCurrency: String(eventItem.registrationCurrency || "INR"),
        isRegistered: Boolean(eventItem.isRegistered),
        isAttending: Boolean(eventItem.isAttending),
        isMissed: Boolean(eventItem.isMissed),
        missedReason: String(eventItem.missedReason || ""),
        currentTab: viewTab,
        viewOnly: Boolean(viewOnly),
        registrationLocked: Boolean(eventItem.registrationLocked),
        registrationData: registrationPayload
      }
    });
    setRegistrationConfirmOpen(false);
    setRegistrationEventItem(null);
  };
  const saveOptionalOutcome = async (eventItem) => {
    const eventId = eventItem?._id;
    if (!eventId) return;
    setOutcomeFormEventItem(eventItem);
    setOutcomeFormCallback(() => ((payload) => saveOutcomeData(payload, eventItem)));
    setOutcomeFormOpen(true);
  };

  const saveOutcomeData = async (payload, targetEventItem = outcomeFormEventItem) => {
    const eventId = targetEventItem?._id;
    if (!eventId) return;
    
    if (!Object.keys(payload).length) {
      setOutcomeFormOpen(false);
      setOutcomeFormEventItem(null);
      setOutcomeFormCallback(null);
      return;
    }

    // Show confirmation before saving
    setOutcomeConfirmPayload(payload);
    setOutcomeConfirmEventItem(targetEventItem);
    setOutcomeFormOpen(false);
    setOutcomeConfirmOpen(true);
  };

  const confirmAndSaveOutcome = async () => {
    const eventId = outcomeConfirmEventItem?._id;
    if (!eventId || !outcomeConfirmPayload) return;

    try {
      const { data } = await API.put(`/events/${eventId}/outcome`, outcomeConfirmPayload);
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      
      // If this came from markAttended flow, mark as attended after saving outcome
      if (outcomeConfirmIsFromMarkAttended) {
        await markAsAttended(eventId);
      } else {
        await fetchEvents();
      }
      
      setOutcomeConfirmOpen(false);
      setOutcomeConfirmPayload(null);
      setOutcomeConfirmEventItem(null);
      setOutcomeConfirmIsFromMarkAttended(false);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save outcome details");
    }
  };

  const markAttended = async (eventItem) => {
    const eventId = eventItem?._id;
    if (!eventId) return;
    setAttendedConfirmEventItem(eventItem);
    setAttendedConfirmOpen(true);
  };

  const openMissedDialog = (eventItem) => {
    if (!eventItem?._id) return;
    setMissedConfirmEventItem(eventItem);
    setMissedReasonInput(String(eventItem?.missedReason || ""));
    setMissedReasonError("");
    setMissedConfirmOpen(true);
  };

  const markAsAttended = async (eventId) => {
    if (!eventId) return;
    try {
      const { data } = await API.put(`/events/${eventId}/attending`, {
        attending: true
      });
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      await fetchEvents();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to mark event as attended");
    }
  };

  const confirmAndMarkMissed = async () => {
    const eventId = missedConfirmEventItem?._id;
    if (!eventId) return;
    const reason = String(missedReasonInput || "").trim();
    if (!reason) {
      setMissedReasonError("Please provide a reason for marking this event as missed.");
      return;
    }

    try {
      const { data } = await API.put(`/events/${eventId}/missed`, { reason });
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      setMissedConfirmOpen(false);
      setMissedConfirmEventItem(null);
      setMissedReasonInput("");
      setMissedReasonError("");
      await fetchEvents();
    } catch (err) {
      setMissedReasonError(err?.response?.data?.message || "Failed to mark event as missed");
    }
  };

  const confirmAndMarkAttended = async () => {
    const targetEventItem = attendedConfirmEventItem;
    const eventId = targetEventItem?._id;
    if (!eventId) return;

    // Don't mark as attended yet - let user enter outcome first
    setOutcomeFormEventItem(targetEventItem);
    setOutcomeFormIsFromMarkAttended(true);
    setOutcomeFormCallback(() => ((payload) => completeAttendanceWithOptionalOutcome(payload, targetEventItem)));
    setAttendedConfirmOpen(false);
    setAttendedConfirmEventItem(null);
    setOutcomeFormOpen(true);
  };

  const completeAttendanceWithOptionalOutcome = async (outcomePayload, targetEventItem = outcomeFormEventItem) => {
    const eventId = targetEventItem?._id;
    if (!eventId) return;

    if (outcomePayload && Object.keys(outcomePayload).length) {
      // Has outcome data - show confirm dialog before marking attended
      setOutcomeConfirmPayload(outcomePayload);
      setOutcomeConfirmEventItem(targetEventItem);
      setOutcomeConfirmIsFromMarkAttended(true);
      setOutcomeFormOpen(false);
      setOutcomeConfirmOpen(true);
    } else {
      // No outcome data - mark as attended directly
      await markAsAttended(eventId);
      setOutcomeFormOpen(false);
      setOutcomeFormEventItem(null);
      setOutcomeFormCallback(null);
      setOutcomeFormIsFromMarkAttended(false);
    }
  };

  const dedupedEvents = useMemo(() => events, [events]);

  const pendingInvitations = useMemo(
    () => dedupedEvents.filter((eventItem) => Boolean(eventItem.isPendingInvitation)),
    [dedupedEvents]
  );

  const acceptInvitation = async (eventItem) => {
    const eventId = eventItem?._id;
    if (!eventId) return;

    try {
      setAcceptingInvitationId(eventId);
      const { data } = await API.put(`/events/${eventId}/accept-invitation`);
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      setViewTab("registered");
      await fetchEvents();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to accept invitation");
    } finally {
      setAcceptingInvitationId("");
    }
  };

  const rejectInvitation = async (eventItem) => {
    const eventId = eventItem?._id;
    if (!eventId) return;

    try {
      setRejectingInvitationId(eventId);
      const { data } = await API.put(`/events/${eventId}/reject-invitation`);
      setEvents((prev) => prev.map((item) => (item._id === eventId ? data : item)));
      await fetchEvents();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to reject invitation");
    } finally {
      setRejectingInvitationId("");
    }
  };

  const industryOptions = useMemo(() => {
    const map = new Map();
    dedupedEvents.forEach((item) => {
      const id = item.industry?._id;
      const name = item.industry?.name;
      if (id && name) map.set(id, name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [dedupedEvents]);

  const locationOptions = useMemo(() => {
    const set = new Set();
    dedupedEvents.forEach((item) => {
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
  }, [dedupedEvents]);

  const sourceOptions = useMemo(() => {
    const values = new Map();
    dedupedEvents.forEach((item) => {
      const name = String(item.source?.name || "").trim();
      if (name) {
        values.set(name.toLowerCase(), name);
      }
    });
    return Array.from(values.values()).sort((left, right) => left.localeCompare(right));
  }, [dedupedEvents]);

  const filteredEvents = useMemo(() => {
    const query = locationQuery.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const prepReadyDate = new Date(startOfToday);
    prepReadyDate.setDate(prepReadyDate.getDate() + 3);
    const registrationGraceBoundary = new Date(startOfToday);
    registrationGraceBoundary.setDate(registrationGraceBoundary.getDate() - 4);

    return dedupedEvents.filter((eventItem) => {
      const matchesIndustry = industryFilter === "all" || eventItem.industry?._id === industryFilter;
      const eventSource = String(eventItem.source?.name || "").trim().toLowerCase();
      const matchesSource = sourceFilter === "all" || eventSource === sourceFilter;
      const matchesLocation =
        !query ||
        contains(eventItem.location?.city, query) ||
        contains(eventItem.location?.State, query) ||
        contains(eventItem.location?.state, query) ||
        contains(eventItem.venue, query) ||
        contains(eventItem.address, query) ||
        contains(eventItem.name, query);

      const eventStart = eventItem.startDate ? new Date(eventItem.startDate) : null;
      const eventEnd = eventItem.endDate ? new Date(eventItem.endDate) : eventStart;
      const isPastEvent = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < startOfToday);
      const isBeyondRegistrationGrace = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < registrationGraceBoundary);
      const isPrepReadyUpcoming = Boolean(
        eventStart &&
        !Number.isNaN(eventStart.getTime()) &&
        eventStart >= prepReadyDate
      );
      const isAttending = Boolean(eventItem.isAttending);
      const attendedByCount = Array.isArray(eventItem.attendedBy) ? eventItem.attendedBy.length : 0;
      const registeredByCount = Array.isArray(eventItem.registeredBy) ? eventItem.registeredBy.length : 0;
      const hasAnyAttendance = attendedByCount > 0;
      const hasAnyRegistration = registeredByCount > 0 || Boolean(eventItem.isRegistered);
      const explicitlyMissed = Boolean(eventItem.isMissed || String(eventItem.missedReason || "").trim());
      const markedAttending = isRestrictedUser ? isAttending : hasAnyAttendance;
      const registrationFlag = isRestrictedUser ? Boolean(eventItem.isRegistered) : hasAnyRegistration;
      // Show in registered tab if registered and not attended (before grace period ends)
      // After grace period, only show if marked as attended, otherwise move to missed
      const registeredForTab = registrationFlag && !markedAttending && !explicitlyMissed && !isBeyondRegistrationGrace;
      const attendedForTab = markedAttending;
      // Show in missed tab after 4-day grace period if still not marked attended
      const missedForTab = explicitlyMissed || (registrationFlag && !markedAttending && isBeyondRegistrationGrace);

      let matchesTab = true;
      switch (viewTab) {
        case "upcoming":
          matchesTab = isPrepReadyUpcoming && !registrationFlag && !attendedForTab;
          break;
        case "registered":
          matchesTab = registeredForTab;
          break;
        case "attended":
          matchesTab = attendedForTab;
          break;
        case "missed":
          matchesTab = missedForTab;
          break;
        default:
          matchesTab = true;
      }

      let matchesQuick = true;
      if (quickFilter === "this-month") {
        const start = eventStart;
        matchesQuick =
          Boolean(start) &&
          !Number.isNaN(start.getTime()) &&
          start.getMonth() === now.getMonth() &&
          start.getFullYear() === now.getFullYear();
      }
      if (quickFilter === "near-me") {
        const distanceKm = distanceFromUserKm(eventItem, userCoordinates);
        if (distanceKm !== null) {
          matchesQuick = distanceKm <= NEAR_ME_RADIUS_KM;
        } else {
          matchesQuick = matchesLocationFallback(eventItem, userPlace);
        }
      }

      return matchesIndustry && matchesSource && matchesLocation && matchesTab && matchesQuick;
    });
  }, [dedupedEvents, industryFilter, sourceFilter, locationQuery, viewTab, quickFilter, userCoordinates, userPlace, isRestrictedUser]);

  const sortedEvents = useMemo(() => {
    const withDuration = (eventItem) => {
      const start = eventItem.startDate ? new Date(eventItem.startDate) : null;
      const end = eventItem.endDate ? new Date(eventItem.endDate) : start;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
      return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
    };

    const rows = [...filteredEvents];
    rows.sort((left, right) => {
      const leftStart = left.startDate ? new Date(left.startDate).getTime() : 0;
      const rightStart = right.startDate ? new Date(right.startDate).getTime() : 0;
      const leftName = String(left.name || "").toLowerCase();
      const rightName = String(right.name || "").toLowerCase();
      const leftScore = Number(left.aiRelevanceScore || 0);
      const rightScore = Number(right.aiRelevanceScore || 0);
      const leftRoi = toOptionalNumber(left.predictedROI) ?? -Infinity;
      const rightRoi = toOptionalNumber(right.predictedROI) ?? -Infinity;
      const leftDuration = withDuration(left);
      const rightDuration = withDuration(right);

      if (sortBy === "date_desc") return rightStart - leftStart;
      if (sortBy === "name_asc") return leftName.localeCompare(rightName);
      if (sortBy === "name_desc") return rightName.localeCompare(leftName);
      if (sortBy === "duration_desc") return rightDuration - leftDuration;
      if (sortBy === "duration_asc") return leftDuration - rightDuration;
      if (sortBy === "score_desc") return rightScore - leftScore;
      if (sortBy === "score_asc") return leftScore - rightScore;
      if (sortBy === "roi_desc") return rightRoi - leftRoi;
      if (sortBy === "roi_asc") return leftRoi - rightRoi;
      return leftStart - rightStart;
    });
    return rows;
  }, [filteredEvents, sortBy]);

  const registeredCount = Number(summary.registeredEvents || 0);
  const attendingCount = Number(summary.attendingEvents || 0);
  const missedCount = Number(summary.missedPastEvents || 0);
  const avgAiScore = Number(summary.avgAiScore || 0);
  const localUpcomingCount = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const prepReadyDate = new Date(startOfToday);
    prepReadyDate.setDate(prepReadyDate.getDate() + 3);
    return dedupedEvents.filter((eventItem) => {
      const eventStart = eventItem.startDate ? new Date(eventItem.startDate) : null;
      const registeredByCount = Array.isArray(eventItem.registeredBy) ? eventItem.registeredBy.length : 0;
      const attendedByCount = Array.isArray(eventItem.attendedBy) ? eventItem.attendedBy.length : 0;
      const hasRegistration = registeredByCount > 0 || Boolean(eventItem.isRegistered);
      const hasAttendance = attendedByCount > 0 || Boolean(eventItem.isAttending);
      return Boolean(eventStart && !Number.isNaN(eventStart.getTime()) && eventStart >= prepReadyDate && !hasRegistration && !hasAttendance);
    }).length;
  }, [dedupedEvents]);
  const upcomingCount = summary.upcomingEvents === null || summary.upcomingEvents === undefined
    ? localUpcomingCount
    : Number(summary.upcomingEvents || 0);
  const invitationCount = upcomingCount;
  const pendingInvitationCount = pendingInvitations.length;
  const todayFetchedCount = Number(summary.todayFetchedCount || 0);

  return (
    <div className="event-page">

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
              <p>{attendingCount} attended | {missedCount} missed</p>
            </div>

            <div className="event-card event-card-accent-orange">
              <h4>Avg AI Score</h4>
              <h2>{avgAiScore.toFixed(1)}</h2>
              <p>Across tracked events</p>
            </div>

            <div className="event-card event-card-accent-purple">
              <h4>Today's Fetch</h4>
              <h2>{loading ? "..." : `${todayFetchedCount} new`}</h2>
              <p>Events fetched today</p>
            </div>
          </>
        )}
      </div>

      <div className="event-section">
        <div className="event-section-header">
          <div className="event-view-tabs event-view-tabs-row">
            {!isRestrictedUser && (
              <button
                type="button"
                className={viewTab === "upcoming" ? "active" : ""}
                onClick={() => setViewTab("upcoming")}
              >
                Upcoming
              </button>
            )}
            <button
              type="button"
              className={viewTab === "registered" ? "active" : ""}
              onClick={() => setViewTab("registered")}
            >
              Registered
            </button>
            <button
              type="button"
              className={viewTab === "attended" ? "active" : ""}
              onClick={() => setViewTab("attended")}
            >
              Attended
            </button>
            <button
              type="button"
              className={viewTab === "missed" ? "active" : ""}
              onClick={() => setViewTab("missed")}
            >
              Missed
            </button>
          </div>

          <div className="event-dropdowns">
            <select value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)}>
              <option value="all">All Events</option>
              <option value="near-me">Near Me</option>
              <option value="this-month">This Month</option>
            </select>

            <select value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)}>
              <option value="all">All Industries</option>
              {industryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>

            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All Platforms</option>
              {sourceOptions.map((option) => (
                <option key={option} value={option.toLowerCase()}>
                  {option}
                </option>
              ))}
            </select>

            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="date_asc">Sort: Nearest Date</option>
              <option value="date_desc">Sort: Latest Date</option>
              <option value="name_asc">Sort: Name A-Z</option>
              <option value="name_desc">Sort: Name Z-A</option>
              <option value="duration_desc">Sort: Longest Duration</option>
              <option value="duration_asc">Sort: Shortest Duration</option>
              <option value="score_desc">Sort: AI Score High-Low</option>
              <option value="score_asc">Sort: AI Score Low-High</option>
              <option value="roi_desc">Sort: ROI High-Low</option>
              <option value="roi_asc">Sort: ROI Low-High</option>
            </select>

            <input
              type="search"
              list="event-city-list"
              placeholder="Search location (city/state/venue/event)"
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
            />

            <span className="event-listed-count-tag">
              {loading || error ? 0 : sortedEvents.length} event{(loading || error ? 0 : sortedEvents.length) === 1 ? "" : "s"}
            </span>

            {isAdminOrManager && (
              <button className="add-event-btn-section" onClick={openAddEventPage}>
                + Add Event
              </button>
            )}
            {canUsePendingInvitations && (
              <button className="pending-invitations-btn" onClick={() => setPendingModalOpen(true)}>
                Pending Invitations ({pendingInvitations.length})
              </button>
            )}
            <datalist id="event-city-list">
              {locationOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
        </div>

        {quickFilter === "near-me" && (
          <div className="event-location-status">
            {locationStatus === "ready" && (
              userPlace?.city
                ? `Near Me uses your live GPS location around ${
                  userPlace.locality &&
                  String(userPlace.locality).toLowerCase() !== String(userPlace.city).toLowerCase()
                    ? `${userPlace.locality}, ${userPlace.city}`
                    : userPlace.city
                }${userPlace.state ? `, ${userPlace.state}` : ""}.`
                : "Near Me uses your live GPS location."
            )}
            {locationStatus === "loading" && "Fetching your live location..."}
            {locationStatus === "unsupported" && "Location is not supported in this browser."}
            {locationStatus === "error" && (locationError || "Could not fetch your location.")}
          </div>
        )}

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

        {!loading && !error && sortedEvents.length === 0 && (
          <div className="event-empty-state">
            <h4>No events found</h4>
            <p>Try another filter or switch the event tab.</p>
          </div>
        )}

        {!loading && !error && sortedEvents.map((eventItem) => {
          const score = Number(eventItem.aiRelevanceScore || 0);
          const scoreLabel = score >= 90 ? "Must Attend" : score >= 70 ? "Strong Fit" : "Evaluate";
          const priorityLabel = formatPriority(eventItem.priorityTag);
          const aiRecommendationText = String(eventItem.aiRecommendation || "").trim();
          const searchEventUrl = buildEventSearchUrl(eventItem);
          const isAiSuggested = Boolean(aiRecommendationText);
          const isAttending = Boolean(eventItem.isAttending);
          const hasRegistrationData = Array.isArray(eventItem.registrations) && eventItem.registrations.length > 0;
          const roleComparison = getRoleComparison(eventItem);
          const distanceKm = distanceFromUserKm(eventItem, userCoordinates);
          const attendingUsers = Array.isArray(eventItem.attendedBy)
            ? eventItem.attendedBy
              .map((user) => user?.name || user?.email || "")
              .filter(Boolean)
            : [];
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const registrationGraceBoundary = new Date(startOfToday);
          registrationGraceBoundary.setDate(registrationGraceBoundary.getDate() - 4);
          const eventEnd = eventItem.endDate ? new Date(eventItem.endDate) : (eventItem.startDate ? new Date(eventItem.startDate) : null);
          const isPastEvent = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < startOfToday);
          const isBeyondRegistrationGrace = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < registrationGraceBoundary);
          const hasAttendance = Array.isArray(eventItem.attendedBy) && eventItem.attendedBy.length > 0;
          const hasRegistration =
            (Array.isArray(eventItem.registeredBy) && eventItem.registeredBy.length > 0) ||
            Boolean(eventItem.isRegistered);
          const isMarkedMissed = Boolean(eventItem.isMissed || String(eventItem.missedReason || "").trim());
          const scopedHasAttendance = isRestrictedUser ? isAttending : hasAttendance;
          const scopedHasRegistration = isRestrictedUser ? Boolean(eventItem.isRegistered) : hasRegistration;
          const registrationWebsiteUrl = String(
            eventItem.myRegistration?.websiteUrl ||
            eventItem.registrationWebsiteUrl ||
            ""
          ).trim();
          const isUpcomingTab = viewTab === "upcoming";
          const isRegisteredTab = viewTab === "registered";
          const isAttendedTab = viewTab === "attended";
          const isMissedTab = viewTab === "missed";
          const canMarkAttended = isRegisteredTab && scopedHasRegistration && !scopedHasAttendance && !isMarkedMissed && isPastEvent;
          const canMarkMissed = isRegisteredTab && scopedHasRegistration && !scopedHasAttendance && !isMarkedMissed && isPastEvent;
          const historyTag = isPastEvent
            ? (scopedHasAttendance ? "Attended" : (scopedHasRegistration ? ((isMarkedMissed || isBeyondRegistrationGrace) ? "Missed" : "Registered") : "Uninterested"))
            : "";
          const outcomeSummaryEntries = [];
          if (eventItem.realizedCollectedLeads != null) {
            outcomeSummaryEntries.push({
              label: "Collected Leads",
              value: formatCount(eventItem.realizedCollectedLeads),
            });
          }
          if (eventItem.realizedQualifiedLeads != null) {
            outcomeSummaryEntries.push({
              label: "Qualified Leads",
              value: formatCount(eventItem.realizedQualifiedLeads),
            });
          }
          if (eventItem.realizedDealsClosed != null) {
            outcomeSummaryEntries.push({
              label: "Deals Closed",
              value: formatCount(eventItem.realizedDealsClosed),
            });
          }
          if (eventItem.realizedRevenue != null) {
            outcomeSummaryEntries.push({
              label: "Revenue",
              value: formatFee(eventItem.realizedRevenue, eventItem.registrationCurrency || "INR"),
            });
          }
          if (eventItem.realizedCost != null) {
            outcomeSummaryEntries.push({
              label: "Investment",
              value: formatFee(eventItem.realizedCost, eventItem.registrationCurrency || "INR"),
            });
          }
          const outcomeSummaryText = outcomeSummaryEntries
            .map((entry) => `${entry.label} ${entry.value}`)
            .join(" | ");

          return (
            <div className="event-item" key={eventItem._id}>
              <div className="event-left">
                <div className="event-title-row">
                  <h4>{eventItem.name}</h4>
                  <span className="score-badge">
                    {score ? `${score} - ${scoreLabel}` : `Priority - ${priorityLabel}`}
                  </span>
                  {historyTag && <span className="history-status-tag">{historyTag}</span>}
                </div>

                <p className="event-meta">{getLocationText(eventItem)}</p>
                <p className="event-meta">{formatDateRange(eventItem.startDate, eventItem.endDate)} ({getDurationText(eventItem.startDate, eventItem.endDate)})</p>

                <p>{eventItem.description || "No description available."}</p>

                <div className="event-tags">
                  <span className="platform-tag">{eventItem.source?.name || "Unknown Platform"}</span>
                  <span>{formatCount(eventItem.attendeesCount)} attendees</span>
                  <span>{formatCount(eventItem.exhibitorsCount)} exhibitors</span>
                  <span>{eventItem.industry?.name || "Industry N/A"}</span>
                  {isAiSuggested && <span className="ai-tag">AI Found</span>}
                  {distanceKm !== null && <span>{distanceKm.toFixed(1)} km away</span>}
                </div>

                {isAiSuggested && (
                  <div className="ai-recommendation">
                    AI Recommendation: {aiRecommendationText || "No AI recommendation available yet."}
                  </div>
                )}

                {roleComparison && (
                  <div className="ai-recommendation roi-comparison-box">
                    ROI:{" "}
                    {roleComparison.visitor ? `Visitor ${formatPredictedROI(roleComparison.visitor.predictedROI)}` : "Visitor N/A"}
                    {" | "}
                    {roleComparison.exhibitor ? `Exhibitor ${formatPredictedROI(roleComparison.exhibitor.predictedROI)}` : "Exhibitor N/A"}
                    {roleComparison.recommendedRole ? ` | Suggested: ${roleComparison.recommendedRole}` : ""}
                    <div className="roi-role-grid">
                      {roleComparison.visitor && (
                        <div className={`roi-role-chip ${roleComparison.recommendedRole === "Visitor" ? "recommended" : ""}`}>
                          <span className="roi-role-label">Visitor</span>
                          <strong>{formatPredictedROI(roleComparison.visitor.predictedROI)}</strong>
                          <small>
                            {roleComparison.visitor.expectedROIRange || "Range N/A"}
                            {Number.isFinite(Number(roleComparison.visitor.confidence))
                              ? ` Â· ${Math.round(Number(roleComparison.visitor.confidence || 0))}% conf`
                              : ""}
                          </small>
                        </div>
                      )}
                      {roleComparison.exhibitor && (
                        <div className={`roi-role-chip ${roleComparison.recommendedRole === "Exhibitor" ? "recommended" : ""}`}>
                          <span className="roi-role-label">Exhibitor</span>
                          <strong>{formatPredictedROI(roleComparison.exhibitor.predictedROI)}</strong>
                          <small>
                            {roleComparison.exhibitor.expectedROIRange || "Range N/A"}
                            {Number.isFinite(Number(roleComparison.exhibitor.confidence))
                              ? ` Â· ${Math.round(Number(roleComparison.exhibitor.confidence || 0))}% conf`
                              : ""}
                          </small>
                        </div>
                      )}
                    </div>
                    <div className="roi-role-summary">
                      Suggested mode: {roleComparison.recommendedRole || "N/A"}
                      {roleComparison.decisionSummary ? ` Â· ${roleComparison.decisionSummary}` : ""}
                    </div>
                  </div>
                )}

                {attendingUsers.length > 0 && (
                  <div className="event-attendance-meta">
                    <strong>Attending:</strong>{" "}
                    {attendingUsers.join(", ")}
                  </div>
                )}

                {outcomeSummaryEntries.length > 0 && (
                  <div className="event-outcome-line" title={outcomeSummaryText}>
                    <strong>Outcome:</strong>{" "}
                    {outcomeSummaryEntries.map((entry, index) => (
                      <React.Fragment key={`${eventItem._id}-${entry.label}`}>
                        <span className="outcome-inline-label">{entry.label}</span>{" "}
                        <span className="outcome-inline-value">{entry.value}</span>
                        {index < outcomeSummaryEntries.length - 1 && (
                          <span className="outcome-inline-sep"> | </span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {isMissedTab && (
                  <div className="event-missed-reason">
                    <strong>Missed Reason:</strong>{" "}
                    {String(eventItem.missedReason || "").trim() || "No reason captured."}
                  </div>
                )}

                <div className="event-actions">
                  {isAdminOrManager && isUpcomingTab && (
                    <button
                      className="primary"
                      onClick={() => openRegistrationForm(eventItem, { viewOnly: false })}
                    >
                      Register
                    </button>
                  )}
                  {isAdmin && (hasRegistrationData || isMissedTab) && !isUpcomingTab && (
                    <button
                      className="primary registered-btn"
                      onClick={() => openRegistrationForm(eventItem, { viewOnly: true })}
                    >
                      View
                    </button>
                  )}
                  {isManager && (hasRegistrationData || isMissedTab) && !isUpcomingTab && (
                    <button
                      className="primary registered-btn"
                      onClick={() => openRegistrationForm(eventItem, { viewOnly: true })}
                    >
                      View
                    </button>
                  )}
                  {canMarkAttended && (
                    <button
                      className="attend-btn"
                      onClick={() => markAttended(eventItem)}
                    >
                      Mark Attended
                    </button>
                  )}
                  {canMarkMissed && (
                    <button
                      className="miss-btn"
                      onClick={() => openMissedDialog(eventItem)}
                    >
                      Mark Missed
                    </button>
                  )}
                  {isAttendedTab && !isAdmin && (
                    <button className="attend-btn" onClick={() => saveOptionalOutcome(eventItem)}>
                      Update Outcome
                    </button>
                  )}
                  {(isRegisteredTab || isAttendedTab || isMissedTab) && (
                    <button
                      onClick={() => registrationWebsiteUrl && window.open(registrationWebsiteUrl, "_blank", "noopener,noreferrer")}
                      disabled={!registrationWebsiteUrl}
                    >
                      {registrationWebsiteUrl ? "View Website" : "No Website URL"}
                    </button>
                  )}
                  {isUpcomingTab && (
                    <button
                      onClick={() => searchEventUrl && window.open(searchEventUrl, "_blank", "noopener,noreferrer")}
                      disabled={!searchEventUrl}
                    >
                      {searchEventUrl ? "Search Event" : "No Search Link"}
                    </button>
                  )}
                  {isMissedTab && (
                    <button
                      className="miss-btn"
                      onClick={() => openMissedDialog(eventItem)}
                    >
                      Update Reason
                    </button>
                  )}
                </div>
              </div>

              <div className="event-right">
                <h3>{formatFee(getDisplayRegistrationFee(eventItem), eventItem.registrationCurrency)}</h3>
                <p>Registration Fee</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      <ConfirmDialog
        isOpen={registrationConfirmOpen}
        title="Confirm Registration"
        message="Proceed to registration? You will need manager, attendee, role, website and payment details."
        confirmText="Continue"
        cancelText="Cancel"
        onConfirm={() => proceedToRegistration(registrationEventItem)}
        onCancel={() => {
          setRegistrationConfirmOpen(false);
          setRegistrationEventItem(null);
        }}
      />

      <OutcomeForm
        isOpen={outcomeFormOpen}
        allowEmptySubmit={outcomeFormIsFromMarkAttended}
        onSubmit={(payload) => {
          if (outcomeFormCallback) {
            outcomeFormCallback(payload);
          }
        }}
        onCancel={() => {
          setOutcomeFormOpen(false);
          setOutcomeFormEventItem(null);
          setOutcomeFormCallback(null);
          setOutcomeFormIsFromMarkAttended(false);
        }}
      />

      <ConfirmDialog
        isOpen={outcomeConfirmOpen}
        title="Confirm Outcome"
        message="Save these outcome details? You can update them later as needed."
        confirmText="Save"
        cancelText="Cancel"
        onConfirm={confirmAndSaveOutcome}
        onCancel={() => {
          setOutcomeConfirmOpen(false);
          setOutcomeConfirmPayload(null);
          setOutcomeConfirmEventItem(null);
          setOutcomeConfirmIsFromMarkAttended(false);
        }}
      />

      <ConfirmDialog
        isOpen={attendedConfirmOpen}
        title="Mark as Attended"
        message="Mark this event as attended? This action cannot be reversed."
        confirmText="Mark Attended"
        cancelText="Cancel"
        isWarning={true}
        onConfirm={confirmAndMarkAttended}
        onCancel={() => {
          setAttendedConfirmOpen(false);
          setAttendedConfirmEventItem(null);
        }}
      />

      <ConfirmDialog
        isOpen={missedConfirmOpen}
        title="Mark as Missed"
        message="Provide the reason for missing this event."
        confirmText="Mark Missed"
        cancelText="Cancel"
        isWarning={true}
        disableConfirm={!String(missedReasonInput || "").trim()}
        onConfirm={confirmAndMarkMissed}
        onCancel={() => {
          setMissedConfirmOpen(false);
          setMissedConfirmEventItem(null);
          setMissedReasonInput("");
          setMissedReasonError("");
        }}
      >
        <textarea
          className="missed-reason-input"
          rows="3"
          value={missedReasonInput}
          onChange={(event) => {
            setMissedReasonInput(event.target.value);
            setMissedReasonError("");
          }}
          placeholder="Example: Team unavailable due to client escalation."
        />
        {missedReasonError && <p className="missed-reason-error">{missedReasonError}</p>}
      </ConfirmDialog>

      {pendingModalOpen && (
        <div className="event-modal-backdrop" role="presentation" onMouseDown={() => setPendingModalOpen(false)}>
          <div className="event-invitations-modal" role="dialog" aria-modal="true" aria-label="Pending invitations" onMouseDown={(event) => event.stopPropagation()}>
            <div className="event-invitations-head">
              <div>
                <h3>Pending Invitations</h3>
                <p>{pendingInvitations.length} invitation{pendingInvitations.length === 1 ? "" : "s"} waiting for response</p>
              </div>
              <button type="button" className="event-modal-close" onClick={() => setPendingModalOpen(false)}>Close</button>
            </div>

            <div className="event-invitations-list">
              {pendingInvitations.length ? (
                pendingInvitations.map((eventItem) => (
                  <div className="event-invitation-row" key={`pending-${eventItem._id}`}>
                    <div>
                      <strong>{eventItem.name || "Untitled Event"}</strong>
                      <span>{getLocationText(eventItem)}</span>
                      <small>{formatDateRange(eventItem.startDate, eventItem.endDate)}</small>
                    </div>
                    <div className="event-invitation-actions">
                      <button
                        type="button"
                        className="accept-invitation-btn"
                        onClick={() => acceptInvitation(eventItem)}
                        disabled={acceptingInvitationId === eventItem._id || rejectingInvitationId === eventItem._id}
                      >
                        {acceptingInvitationId === eventItem._id ? "Accepting..." : "Accept"}
                      </button>
                      <button
                        type="button"
                        className="reject-invitation-btn"
                        onClick={() => rejectInvitation(eventItem)}
                        disabled={acceptingInvitationId === eventItem._id || rejectingInvitationId === eventItem._id}
                      >
                        {rejectingInvitationId === eventItem._id ? "Rejecting..." : "Reject"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="event-empty-state event-invitation-empty">
                  <h4>No pending invitations</h4>
                  <p>Accepted invitations will appear in the Registered tab.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default EventExpo;
