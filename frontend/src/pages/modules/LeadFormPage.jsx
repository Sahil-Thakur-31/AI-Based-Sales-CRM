import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import BackButton from "../../components/BackButton";
import { DEAL_STAGE_OPTIONS, LEAD_STAGE_OPTIONS, getStageTitle } from "../../utils/stages";
import "./styles/LeadsDashboard.css";

function getUserIdFromToken() {
  try {
    const token = localStorage.getItem("token");
    if (!token) return "";
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized));
    return decoded?._id ? String(decoded._id) : "";
  } catch (_) {
    return "";
  }
}

function normalizeSourceName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactOcrText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeOcrIdentityKey(value) {
  return compactOcrText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeOcrPersonKey(value) {
  const parts = compactOcrText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

  if (!parts.length) return "";
  return [...parts].sort().join(" ");
}

function splitOcrField(value) {
  return String(value || "")
    .split(/\s*(?:\||,|;|\n)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeContactValueList(value) {
  const values = Array.isArray(value)
    ? value.flatMap((item) => splitOcrField(item))
    : splitOcrField(value);

  return values.filter((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized && normalized !== "unreadable" && normalized !== "undefined" && normalized !== "null";
  });
}

function uniqueOcrValues(values, getKey = null) {
  const seen = new Set();
  const out = [];

  for (const value of Array.isArray(values) ? values : [values]) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = typeof getKey === "function"
      ? getKey(text)
      : text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function mapContactForForm(contact = {}) {
  return {
    ...contact,
    _id: contact?._id || "",
    name: contact?.name || "",
    designation: contact?.designation || "",
    phone: normalizeContactValueList(contact?.phone).length ? normalizeContactValueList(contact?.phone) : [""],
    email: normalizeContactValueList(contact?.email).length ? normalizeContactValueList(contact?.email) : [""],
    linkedin: contact?.linkedin || "",
    address: contact?.address || "",
    is_primary: Boolean(contact?.is_primary),
    is_active: contact?.is_active !== false,
  };
}

function looksLikeOcrCompanyText(value) {
  const text = compactOcrText(value);
  if (!text) return false;

  const normalized = text.toLowerCase();
  if (/@|www\.|https?:\/\//i.test(text)) return true;
  if (/[!&]/.test(text) && text.split(" ").length >= 2) return true;
  if (/(services?|solutions?|media|foods?|products?|industr(?:y|ies)|enterprise|power|energy|systems?|equipment|repairs?|works|digital|agency|tech|technologies|traders?|mart|group|studio|llp|ltd|pvt|inc|corp)\b/i.test(normalized)) {
    return true;
  }
  if (/(slogan|logo|digitally|trusted|quality|since)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function looksLikeOcrPersonName(value, companyHints = []) {
  const text = compactOcrText(value);
  if (!text) return false;
  if (text.includes("/")) return false;
  if (/\d/.test(text)) return false;
  if (/@|www\.|https?:\/\//i.test(text)) return false;

  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.length > 4) return false;

  const normalized = text.toLowerCase();
  if (/(designer|developer|engineer|manager|director|officer|executive|consultant|analyst|lead|head|founder|owner|sales|marketing|ui|ux)\b/.test(normalized)) {
    return false;
  }
  if (looksLikeOcrCompanyText(text)) return false;
  if (text === text.toUpperCase() && parts.some((part) => part.length > 6) && !/^[A-Z. ]+$/.test(text.replace(/[^A-Z. ]/g, ""))) {
    return false;
  }
  const textKey = normalizeOcrIdentityKey(text);
  if (companyHints.some((candidate) => {
    const candidateKey = normalizeOcrIdentityKey(candidate);
    return candidateKey && textKey && (candidateKey === textKey || candidateKey.includes(textKey) || textKey.includes(candidateKey));
  })) {
    return false;
  }

  return true;
}

function extractOcrPersonNames(value, companyHints = []) {
  const names = splitOcrField(value).filter((candidate) => looksLikeOcrPersonName(candidate, companyHints));
  if (names.length) return names;

  const fallback = splitOcrField(value).filter((candidate) => !looksLikeOcrCompanyText(candidate));
  return fallback.length ? [fallback[0]] : [];
}

function splitOcrAddressField(value) {
  return String(value || "")
    .split(/\s*(?:\||\n)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactOcrLineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function joinLineLabels(lineLabels, targetLabel, limit = Infinity) {
  const seen = new Set();
  const out = [];

  for (const line of Array.isArray(lineLabels) ? lineLabels : []) {
    if (String(line?.label || "").toUpperCase() !== targetLabel) continue;
    const text = compactOcrLineText(line?.text || "");
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }

  return out.join(" ").trim();
}

function extractLineLabelValues(lineLabels, targetLabel) {
  return uniqueOcrValues(
    (Array.isArray(lineLabels) ? lineLabels : [])
      .filter((line) => String(line?.label || "").toUpperCase() === targetLabel)
      .map((line) => compactOcrLineText(line?.text || ""))
  );
}

function looksLikeContactInfo(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  if (/(?:https?:\/\/|www\.)/i.test(text)) return true;
  return /(?:\+?\d[\d\s().-]{8,}\d)/.test(text);
}

function normalizeOcrAddress(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const parts = splitOcrAddressField(text);
  if (!parts.length) return text;

  const cleaned = parts
    .slice(0, 2)
    .join(" ")
    .replace(/^(?:\+?\d[\d\s().-]{7,}\d)\s*[,;:-]\s*/u, "")
    .replace(/\s{2,}/g, " ")
    .trim(" ,;");

  return cleaned || text;
}

function resolveOcrCompanyName(ocrData, ocrLineLabels = []) {
  const companyCandidates = splitOcrField(ocrData?.company);
  const company = companyCandidates.filter(Boolean).slice(0, 2).join(" ").trim();

  if (company) return company;
  const personFallback = uniqueOcrValues([
    ...extractOcrPersonNames(ocrData?.name),
    ...extractLineLabelValues(ocrLineLabels, "NAME"),
  ])[0];
  return personFallback || "";
}

function buildInitialOcrContacts(ocrData, ocrLineLabels) {
  const fallbackDesignation = String(ocrData?.designation || "").trim() || joinLineLabels(ocrLineLabels, "DESIGNATION");
  const companyCandidates = uniqueOcrValues([
    ...splitOcrField(ocrData?.company),
    ...extractLineLabelValues(ocrLineLabels, "COMPANY"),
  ]);
  const names = uniqueOcrValues([
    ...extractOcrPersonNames(ocrData?.name, companyCandidates),
    ...extractLineLabelValues(ocrLineLabels, "NAME").filter((candidate) => looksLikeOcrPersonName(candidate, companyCandidates)),
  ], normalizeOcrPersonKey);
  const phones = uniqueOcrValues(
    [
      ...normalizeContactValueList(ocrData?.phone),
      ...normalizeContactValueList(extractLineLabelValues(ocrLineLabels, "PHONE")),
    ],
    (value) => String(value || "").replace(/\D+/g, "")
  );
  const emails = uniqueOcrValues(
    [
      ...normalizeContactValueList(ocrData?.email),
      ...normalizeContactValueList(extractLineLabelValues(ocrLineLabels, "EMAIL")),
    ],
    (value) => String(value || "").trim().toLowerCase()
  );
  const designations = uniqueOcrValues([
    ...splitOcrField(ocrData?.designation),
    ...extractLineLabelValues(ocrLineLabels, "DESIGNATION"),
  ]);
  const shouldCreateSeparateContacts = names.length > 1;

  if (!shouldCreateSeparateContacts) {
    return [{
      name: names[0] || "",
      designation: designations[0] || fallbackDesignation,
      phone: phones.length ? phones : [""],
      email: emails.length ? emails : [""],
      linkedin: "",
      address: "",
      is_primary: true,
    }];
  }

  const count = names.length;
  const contacts = Array.from({ length: count }).map((_, i) => ({
    name: names[i] || "",
    designation: designations[i] || (i === 0 ? (designations[0] || fallbackDesignation) : ""),
    phone: phones[i] ? [phones[i]] : [""],
    email: emails[i] ? [emails[i]] : [""],
    linkedin: "",
    address: "",
    is_primary: i === 0,
  }));

  if (phones.length > count) {
    const extraPhones = phones.slice(count);
    contacts[0].phone = uniqueOcrValues([
      ...normalizeContactValueList(contacts[0].phone),
      ...extraPhones,
    ]);
  }

  if (emails.length > count) {
    const extraEmails = emails.slice(count);
    contacts[0].email = uniqueOcrValues([
      ...normalizeContactValueList(contacts[0].email),
      ...extraEmails,
    ], (value) => String(value || "").trim().toLowerCase());
  }

  return contacts;
}

function LeadFormPage({ formMode = "", embedded = false, forcedView = "", onCancel = null, onSaved = null }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdmin = roleName === "admin";
  const isAdminOrManager = roleName === "admin" || roleName === "manager";
  const currentUserId = getUserIdFromToken();

  const isNew = embedded ? true : id === "new" || !id;
  const searchParams = new URLSearchParams(location.search);
  const deletedView = embedded ? false : searchParams.get("deleted") === "true";
  const dealView = embedded ? forcedView === "deal" : searchParams.get("view") === "deal";
  const clientView = formMode === "client" || searchParams.get("view") === "client";
  const dealIdFromQuery = searchParams.get("dealId") || (dealView ? String(id || "") : "");
  const clientIdFromQuery = searchParams.get("clientId") || "";
  const shouldStartInEditMode = embedded
    ? true
    : !deletedView && (isNew || searchParams.get("edit") === "true");
  const [editMode, setEditMode] = useState(shouldStartInEditMode);
  const [popup, setPopup] = useState({
    open: false,
    mode: "alert",
    title: "",
    message: "",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
    variant: "info",
    onConfirm: null,
  });
  const [dealDeleteReason, setDealDeleteReason] = useState("");
  const [companySuggestions, setCompanySuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const companySearchTimer = useRef(null);
  const suggestionsRef = useRef(null);
  const sourceMenuRef = useRef(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceSubmenu, setSourceSubmenu] = useState({ type: "", sourceId: "" });
  const [sourceSubmenuDirection, setSourceSubmenuDirection] = useState("right");
  const [sourceSubmenuTop, setSourceSubmenuTop] = useState(0);

  useEffect(() => {
    setEditMode(shouldStartInEditMode);
  }, [shouldStartInEditMode]);

  const ocrData = location.state?.ocrData || null;
  const ocrLineLabels = Array.isArray(location.state?.ocrLineLabels)
    ? location.state.ocrLineLabels
    : [];
  const ocrPreview = location.state?.ocrPreview || "";
  const ocrPreviews = Array.isArray(location.state?.ocrPreviews)
    ? location.state.ocrPreviews.filter(Boolean)
    : ocrPreview
      ? [ocrPreview]
      : [];
  const ocrWarning = location.state?.ocrWarning || "";
  const hasOcrContext = Boolean(ocrData || ocrPreviews.length || ocrWarning);
  const shouldApplyOcr = Boolean(ocrData);
  const isFromOCR = shouldApplyOcr;
  const [selectedOcrPreviewIndex, setSelectedOcrPreviewIndex] = useState(0);

  const ocrCompanyName = useMemo(() => {
    const fromData = resolveOcrCompanyName(ocrData, ocrLineLabels);
    const fromLabels = joinLineLabels(ocrLineLabels, "COMPANY", 2);
    return fromData || fromLabels;
  }, [ocrLineLabels, ocrData]);

  const ocrAddressValue = useMemo(() => {
    const fromData = normalizeOcrAddress(ocrData?.address || "");
    const fromLabels = joinLineLabels(ocrLineLabels, "ADDRESS");
    return fromData || fromLabels;
  }, [ocrLineLabels, ocrData]);

  useEffect(() => {
    setSelectedOcrPreviewIndex(0);
  }, [ocrPreviews.length]);

  const initialContacts = useMemo(() => {
    if (!shouldApplyOcr) return [{ name: "", designation: "", phone: [""], email: [""], linkedin: "", address: "", is_primary: true }];
    return buildInitialOcrContacts(ocrData, ocrLineLabels);
  }, [ocrData, ocrLineLabels, shouldApplyOcr]);

  const [lead, setLead] = useState({
    deal_name: "",
    company_name: shouldApplyOcr ? ocrCompanyName : "",
    industry: "",
    employee_count: "",
    turnover_range: "",
    Address: shouldApplyOcr ? ocrAddressValue : "",
    website: shouldApplyOcr ? (ocrData?.website || "") : "",
    source: shouldApplyOcr ? "OCR" : "",
    referred_by_user: "",
    expo_event_id: "",
    country: "",
    State: "",
    city: "",
    deal_value_estimate: "",
    stage: "P3",
    next_action: "",
    next_action_date: "",
    assigned_to: "",
    converted_to_deal: false,
    is_existing_company: false,
    contact_history: [],
  });

  /* ================= DROPDOWNS ================= */
  const [sources, setSources] = useState([]);
  const [locations, setLocations] = useState([]);
  const [stateOptions, setStateOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const assignableUsers = useMemo(
    () =>
      (Array.isArray(users) ? users : []).filter(
        (u) => String(u?.roleName || "").toLowerCase() !== "admin"
      ),
    [users]
  );
  const selectedSource = useMemo(
    () => (Array.isArray(sources) ? sources : []).find((s) => String(s?._id) === String(lead.source || "")) || null,
    [sources, lead.source]
  );
  const normalizedSourceName = useMemo(
    () => normalizeSourceName(selectedSource?.name || ""),
    [selectedSource]
  );
  const isReferenceLikeSource = useMemo(
    () => /(ref|refer|reference|referr|reffe|refee)/.test(normalizedSourceName),
    [normalizedSourceName]
  );
  const isEventExpoLikeSource = useMemo(
    () =>
      (normalizedSourceName.includes("event") && normalizedSourceName.includes("expo")) ||
      normalizedSourceName.includes("events n expos"),
    [normalizedSourceName]
  );
  const referenceSources = useMemo(
    () =>
      (Array.isArray(sources) ? sources : []).filter((s) =>
        /(ref|refer|reference|referr|reffe|refee)/.test(normalizeSourceName(s?.name))
      ),
    [sources]
  );
  const eventExpoSources = useMemo(
    () =>
      (Array.isArray(sources) ? sources : []).filter((s) => {
        const normalized = normalizeSourceName(s?.name);
        return (
          (normalized.includes("event") && normalized.includes("expo")) ||
          normalized.includes("events n expos")
        );
      }),
    [sources]
  );
  const sourceDisplayValue = useMemo(() => {
    const sourceName = selectedSource?.name || "-";
    if (!lead.source) return "-";
    if (isReferenceLikeSource) {
      const userName = users.find((u) => String(u._id) === String(lead.referred_by_user || ""))?.name || "-";
      return `${sourceName} > ${userName}`;
    }
    if (isEventExpoLikeSource) {
      const eventName = events.find((ev) => String(ev._id) === String(lead.expo_event_id || ""))?.name || "-";
      return `${sourceName} > ${eventName}`;
    }
    return sourceName;
  }, [
    selectedSource,
    lead.source,
    lead.referred_by_user,
    lead.expo_event_id,
    isReferenceLikeSource,
    isEventExpoLikeSource,
    users,
    events,
  ]);
  const normalSources = useMemo(() => {
    const referenceSet = new Set(referenceSources.map((s) => String(s?._id || "")));
    const eventSet = new Set(eventExpoSources.map((s) => String(s?._id || "")));
    return (Array.isArray(sources) ? sources : []).filter((s) => {
      const id = String(s?._id || "");
      return !referenceSet.has(id) && !eventSet.has(id);
    });
  }, [sources, referenceSources, eventExpoSources]);

  /* ================= CONTACTS ================= */


  const [contacts, setContacts] = useState(initialContacts);

  useEffect(() => {
    if (shouldApplyOcr) {
      console.log("Applying OCR Data to formulate:", ocrData);
      const companyVal = ocrCompanyName;

      setLead((prev) => ({
        ...prev,
        company_name: companyVal || prev.company_name,
        Address: (ocrAddressValue && ocrAddressValue !== "UNREADABLE")
          ? ocrAddressValue
          : prev.Address,
        website: (ocrData.website && ocrData.website !== "UNREADABLE") ? ocrData.website : prev.website,
        source: "OCR"
      }));
      setContacts(initialContacts);
    }
  }, [ocrData, ocrAddressValue, ocrCompanyName, initialContacts, shouldApplyOcr]);

  /* ================= LOAD LEAD ================= */
  useEffect(() => {
    const loadData = async () => {
      if (isNew) return;

      try {
        if (clientView) {
          const { data } = await API.get(`/clients/${id}`, {
            params: { include_deleted: deletedView },
          });

          const loadedClient = data?.client || data || {};
          const loadedLocation = loadedClient?.location || {};

          setLead((prev) => ({
            ...prev,
            company_name: loadedClient?.name || "",
            industry: loadedClient?.industry?._id || loadedClient?.industry || "",
            employee_count: loadedClient?.employeeCount ?? "",
            turnover_range: loadedClient?.turnoverRange || "",
            Address: normalizeOcrAddress(loadedClient?.Address || ""),
            website: loadedClient?.website || "",
            source: loadedClient?.source?._id || loadedClient?.source || "",
            referred_by_user:
              loadedClient?.referred_by_user?._id || loadedClient?.referred_by_user || "",
            expo_event_id: loadedClient?.expo_event_id?._id || loadedClient?.expo_event_id || "",
            country: loadedClient?.country || loadedLocation?.country || "",
            State:
              loadedClient?.State ||
              loadedClient?.state ||
            loadedLocation?.State ||
              loadedLocation?.state ||
              "",
            city: loadedClient?.city || loadedLocation?.city || "",
            location: loadedClient?.location?._id || loadedClient?.location || "",
            contact_history: [],
            assigned_to: "",
          }));

          if (Array.isArray(data?.contacts)) {
            const mappedContacts = data.contacts.map((contact) => mapContactForForm(contact));
            setContacts(
              mappedContacts.length
                ? mappedContacts
                : [
                  {
                    name: "",
                    designation: "",
                    phone: [""],
                    email: [""],
                    linkedin: "",
                    is_primary: true,
                  },
                ]
            );
          }

          return;
        }
        // ðŸ”¹ If viewing deal â†’ load deal
        if (dealView && dealIdFromQuery) {
          const { data } = await API.get(`/deals/${dealIdFromQuery}`, {
            params: { include_deleted: deletedView },
          });

          const loadedDeal = data.deal || data;

          setLead({
            ...loadedDeal,
            assigned_to:
              loadedDeal?.assigned_to?._id ||
              loadedDeal?.assigned_to ||
              "",
            source:
              loadedDeal?.source?._id ||
              loadedDeal?.source ||
              "",
            referred_by_user:
              loadedDeal?.referred_by_user?._id ||
              loadedDeal?.referred_by_user ||
              "",
            expo_event_id:
              loadedDeal?.expo_event_id?._id ||
              loadedDeal?.expo_event_id ||
              "",
            contact_history: Array.isArray(loadedDeal.contact_history)
              ? loadedDeal.contact_history
              : [],
          });

          if (data.contacts?.length) setContacts(data.contacts.map((contact) => mapContactForForm(contact)));

          return;
        }

        // ðŸ”¹ Otherwise load lead
        const { data } = await API.get(`/leads/${id}`, {
          params: { include_deleted: deletedView },
        });

        const loadedLead = data.lead || data;

        setLead({
          ...loadedLead,
          assigned_to:
            loadedLead?.assigned_to?._id ||
            loadedLead?.assigned_to ||
            "",
          source:
            loadedLead?.source?._id ||
            loadedLead?.source ||
            "",
          referred_by_user:
            loadedLead?.referred_by_user?._id ||
            loadedLead?.referred_by_user ||
            "",
          expo_event_id:
            loadedLead?.expo_event_id?._id ||
            loadedLead?.expo_event_id ||
            "",
          contact_history: Array.isArray(loadedLead.contact_history)
            ? loadedLead.contact_history
            : [],
        });

        if (data.contacts?.length) setContacts(data.contacts.map((contact) => mapContactForForm(contact)));

      } catch (err) {
        console.error("load error", err);
      }
    };

    loadData();
  }, [id, isNew, deletedView, dealView, dealIdFromQuery, clientView]);

  useEffect(() => {
    const prefillDealFromClient = async () => {
      if (!isNew || !dealView || !clientIdFromQuery) return;

      try {
        const { data } = await API.get(`/clients/${clientIdFromQuery}`);
        const loadedClient = data?.client || {};
        const loadedLocation = loadedClient?.location || {};

        setLead((prev) => ({
          ...prev,
          company_name: loadedClient?.name || prev.company_name || "",
          industry: loadedClient?.industry || prev.industry || "",
          employee_count: loadedClient?.employeeCount ?? prev.employee_count ?? "",
          turnover_range: loadedClient?.turnoverRange || prev.turnover_range || "",
          Address: normalizeOcrAddress(loadedClient?.Address || prev.Address || ""),
          website: loadedClient?.website || prev.website || "",
          source: loadedClient?.source || prev.source || "",
          referred_by_user: loadedClient?.referred_by_user || prev.referred_by_user || "",
          expo_event_id: loadedClient?.expo_event_id || prev.expo_event_id || "",
          country: loadedClient?.country || loadedLocation?.country || prev.country || "",
          State:
            loadedClient?.State ||
            loadedClient?.state ||
            loadedLocation?.State ||
            loadedLocation?.state ||
            prev.State ||
            "",
          city: loadedClient?.city || loadedLocation?.city || prev.city || "",
          assigned_to: prev.assigned_to || currentUserId || "",
          is_existing_company: true,
        }));

        if (Array.isArray(data?.contacts) && data.contacts.length) {
          setContacts(
            data.contacts.map((contact) => mapContactForForm(contact))
          );
        }
      } catch (err) {
        console.error("prefill deal from client error", err);
      }
    };

    prefillDealFromClient();
  }, [isNew, dealView, clientIdFromQuery, currentUserId]);

  /* ================= LOAD DROPDOWNS ================= */
  useEffect(() => {
    const load = async () => {
      const [sourcesRes, locationsRes, industriesRes, usersRes, eventsRes] = await Promise.allSettled([
        API.get("/sources"),
        API.get("/location"),
        API.get("/industries"),
        API.get("/users"),
        API.get("/events"),
      ]);

      if (sourcesRes.status === "fulfilled") {
        setSources(sourcesRes.value.data || []);
      } else {
        console.error("sources load error", sourcesRes.reason);
      }

      if (locationsRes.status === "fulfilled") {
        setLocations(locationsRes.value.data || []);
      } else {
        console.error("locations load error", locationsRes.reason);
      }

      if (industriesRes.status === "fulfilled") {
        setIndustries(Array.isArray(industriesRes.value.data) ? industriesRes.value.data : []);
      } else {
        console.error("industries load error", industriesRes.reason);
      }

      if (usersRes.status === "fulfilled") {
        setUsers(Array.isArray(usersRes.value.data) ? usersRes.value.data : []);
      } else {
        console.error("users load error", usersRes.reason);
      }

      if (eventsRes.status === "fulfilled") {
        setEvents(Array.isArray(eventsRes.value.data) ? eventsRes.value.data : []);
      } else {
        console.error("events load error", eventsRes.reason);
      }
    };

    load();
  }, []);

  useEffect(() => {
    const loadStates = async () => {
      if (!lead.country) {
        setStateOptions([]);
        setCityOptions([]);
        return;
      }
      try {
        const { data } = await API.get("/location", { params: { country: lead.country } });
        setStateOptions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("states load error", err);
        setStateOptions([]);
      }
    };

    loadStates();
  }, [lead.country]);

  useEffect(() => {
    const loadCities = async () => {
      if (!lead.country || !lead.State) {
        setCityOptions([]);
        return;
      }
      try {
        const { data } = await API.get("/location", {
          params: { country: lead.country, State: lead.State },
        });
        setCityOptions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("cities load error", err);
        setCityOptions([]);
      }
    };

    loadCities();
  }, [lead.country, lead.State]);

  useEffect(() => {
    if (!isNew || isAdminOrManager || !currentUserId) return;
    setLead((prev) => ({
      ...prev,
      assigned_to: prev.assigned_to || currentUserId,
    }));
  }, [isNew, isAdminOrManager, currentUserId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!sourceMenuRef.current) return;
      if (!sourceMenuRef.current.contains(event.target)) {
        setSourceMenuOpen(false);
        setSourceSubmenu({ type: "", sourceId: "" });
        setSourceSubmenuTop(0);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const updateSubmenuDirection = () => {
      if (!sourceMenuRef.current) return;
      const rect = sourceMenuRef.current.getBoundingClientRect();
      const submenuWidth = 240;
      const spaceOnRight = window.innerWidth - rect.right;
      const spaceOnLeft = rect.left;
      if (spaceOnRight < submenuWidth && spaceOnLeft >= submenuWidth) {
        setSourceSubmenuDirection("left");
      } else {
        setSourceSubmenuDirection("right");
      }
    };
    updateSubmenuDirection();
    window.addEventListener("resize", updateSubmenuDirection);
    return () => window.removeEventListener("resize", updateSubmenuDirection);
  }, [sourceMenuOpen]);

  /* ================= CHANGE ================= */
  const handleLeadChange = (e) => {
    const { name, value } = e.target;

    setLead((prev) => {
      let updated = { ...prev, [name]: value };

      // reset dependent dropdowns
      if (name === "country") {
        updated.State = "";
        updated.city = "";
      }

      if (name === "State") {
        updated.city = "";
      }

      if (name === "source") {
        updated.referred_by_user = "";
        updated.expo_event_id = "";
      }

      return updated;
    });
  };

  const handleSourceMenuSelect = (type, sourceId, nestedId = "") => {
    setLead((prev) => {
      if (type === "reference") {
        return {
          ...prev,
          source: sourceId || "",
          referred_by_user: nestedId || "",
          expo_event_id: "",
        };
      }
      if (type === "event") {
        return {
          ...prev,
          source: sourceId || "",
          referred_by_user: "",
          expo_event_id: nestedId || "",
        };
      }
      return {
        ...prev,
        source: sourceId || "",
        referred_by_user: "",
        expo_event_id: "",
      };
    });
    setSourceMenuOpen(false);
    setSourceSubmenu({ type: "", sourceId: "" });
    setSourceSubmenuTop(0);
  };

  const handleContactChange = (i, e) => {
    const updated = [...contacts];
    updated[i][e.target.name] = e.target.value;
    setContacts(updated);
  };

  useEffect(() => {
    if (isFromOCR) return;
    if (!lead.company_name) return;
    setContacts((prev) => {
      if (!prev.length) return prev;
      let hasChanges = false;
      const updated = prev.map((c) => {
        if (!c.name) {
          hasChanges = true;
          return { ...c, name: lead.company_name };
        }
        return c;
      });
      return hasChanges ? updated : prev;
    });
  }, [lead.company_name, isFromOCR]);

  const handleHistoryChange = (index, field, value) => {
    setLead((prev) => {
      const history = Array.isArray(prev.contact_history)
        ? [...prev.contact_history]
        : [];
      history[index] = { ...(history[index] || {}), [field]: value };
      return { ...prev, contact_history: history };
    });
  };

  const addHistoryEntry = () => {
    setLead((prev) => ({
      ...prev,
      contact_history: [
        ...(Array.isArray(prev.contact_history) ? prev.contact_history : []),
        {
          contacted_at: new Date().toISOString().slice(0, 16),
          mode: "call",
          reply: "",
          notes: "",
          next_action: "",
          next_action_date: "",
          is_completed: false,
          completed_at: "",
        },
      ],
    }));
  };

  const removeHistoryEntry = (index) => {
    setLead((prev) => {
      const history = Array.isArray(prev.contact_history)
        ? prev.contact_history.filter((_, i) => i !== index)
        : [];
      return { ...prev, contact_history: history };
    });
  };

  const addContact = () => {
    setContacts([
      ...contacts,
      {
        name: "",
        designation: "",
        phone: [""],
        email: [""],
        linkedin: "",
        address: "",
        is_primary: false,
      },
    ]);
  };

  const removeContact = (i) => {
    if (contacts.length === 1) return;
    const updated = contacts.filter((_, idx) => idx !== i);
    updated[0].is_primary = true;
    setContacts(updated);
  };

  /* ================= SAVE ================= */
  const handleSave = async () => {
    const finalCompanyName = lead.company_name || (!isFromOCR ? contacts[0]?.name : "") || "";

    const sanitizedContacts = contacts.map((contact) => ({
      ...contact,
      name: contact.name || (!isFromOCR ? finalCompanyName : "") || "",
      phone: normalizeContactValueList(contact.phone),
      email: normalizeContactValueList(contact.email),
    }));
    const resolvedContacts = sanitizedContacts.map((contact) => ({
      ...contact,
      phone: contact.phone.join(", "),
      email: contact.email.join(", "),
    }));
    setContacts(
      sanitizedContacts.map((contact) => ({
        ...contact,
        phone: contact.phone.length ? contact.phone : [""],
        email: contact.email.length ? contact.email : [""],
      }))
    );

    setLead((prev) => ({ ...prev, company_name: finalCompanyName }));

    const primaryContact = resolvedContacts.find((contact) => contact.is_primary) || resolvedContacts[0] || {};
    const hasLeadIdentity = Boolean(String(finalCompanyName || "").trim() || String(primaryContact?.name || "").trim());
    const hasPrimaryReachability = Boolean(
      normalizeContactValueList(primaryContact?.phone).length ||
      normalizeContactValueList(primaryContact?.email).length
    );

    if (!hasLeadIdentity || !hasPrimaryReachability) {
      showAlert("Validation", "Please provide a readable company or contact name and at least one phone or email for the primary contact.", "error");
      return;
    }
    if (isReferenceLikeSource && !lead.referred_by_user) {
      showAlert("Validation", "Please select a referral user", "error");
      return;
    }
    if (isEventExpoLikeSource && !lead.expo_event_id) {
      showAlert("Validation", "Please select an event/expo", "error");
      return;
    }

    try {
      let response;

      if (clientView) {
        const payload = {
          name: finalCompanyName,
          industry: lead.industry || "",
          Address: lead.Address || "",
          employeeCount: lead.employee_count || "",
          turnoverRange: lead.turnover_range || "",
          website: lead.website || "",
          source: lead.source || "",
          referred_by_user: lead.referred_by_user || "",
          expo_event_id: lead.expo_event_id || "",
          deal_count: 0,
          location: selectedLocationId || lead.location || null,
          contacts: resolvedContacts.map((contact) => ({
            name: contact.name || "",
            designation: contact.designation || "",
            phone: contact.phone || "",
            email: contact.email || "",
            linkedin: contact.linkedin || "",
            is_active: contact.is_active !== false
          }))
        };

        response = isNew
          ? await API.post("/clients", payload)
          : await API.put(`/clients/${id}`, payload);
      } else {
        const payload = {
          ...lead,
          company_name: finalCompanyName,
          contacts: resolvedContacts.map((contact) => ({
            ...contact,
            address: contact.address || "",
          })),
        };
        delete payload.status;

        response = isNew
          ? await API.post(dealView ? "/deals" : "/leads", payload)
          : await API.put(dealView ? `/deals/${dealIdFromQuery || id}` : `/leads/${id}`, payload);
      }

      const data = response.data;
      if (embedded) {
        if (typeof onSaved === "function") onSaved(data);
        return;
      }

      if (isNew) {
        if (clientView) {
          navigate("/clients");
        } else if (dealView && data.deal) {
          navigate(`/leads/${data.deal._id}?view=deal&dealId=${data.deal._id}`);
        } else {
          navigate(`/leads/${data._id || data.lead?._id}`);
        }
      }
      setEditMode(false);
    } catch (err) {
      console.error("save lead error", err);
      showAlert("Save Failed", err.response?.data?.message || "Failed to save lead", "error");
    }
  };

  /* ================= LOCATION FILTERS ================= */

  const countries = [...new Set(locations.map((l) => l.country))];

  const industryNameMap = useMemo(() => {
    const map = new Map();
    industries.forEach((item) => {
      if (item?._id) map.set(String(item._id), item.name || "");
      if (item?.name) map.set(String(item.name), item.name);
    });
    return map;
  }, [industries]);

  const selectedLocationId = useMemo(() => {
    const selectedCity = cityOptions.find((item) => item?.city === lead.city);
    return selectedCity?._id || null;
  }, [cityOptions, lead.city]);

  const closePopup = () => {
    setDealDeleteReason("");
    setPopup((prev) => ({ ...prev, open: false, onConfirm: null }));
  };

  const showAlert = (title, message, variant = "info") => {
    setPopup({
      open: true,
      mode: "alert",
      title,
      message,
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      variant,
      onConfirm: null,
    });
  };

  const showConfirm = (
    title,
    message,
    onConfirm,
    {
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      variant = "warning",
      mode = "confirm",
    } = {}
  ) => {
    setDealDeleteReason("");
    setPopup({
      open: true,
      mode,
      title,
      message,
      confirmLabel,
      cancelLabel,
      variant,
      onConfirm,
    });
  };

  const handlePopupConfirm = async () => {
    const action = popup.onConfirm;
    const inputReason = dealDeleteReason;
    closePopup();
    if (typeof action === "function") {
      await action(inputReason);
    }
  };

  const handleSoftDelete = async () => {
    if (isNew) return;

    showConfirm(
      "Soft Delete Lead",
      "Are you sure you want to soft delete this lead?",
      async () => {
        try {
          await API.delete(`/leads/${id}`);
          navigate("/leads");
        } catch (err) {
          console.error("delete lead error", err);
          showAlert(
            "Delete Failed",
            err.response?.data?.message || "Failed to delete lead",
            "error"
          );
        }
      },
      { confirmLabel: "Delete", variant: "danger" }
    );
  };

  const handleDeleteClient = async () => {
    if (isNew) return;

    showConfirm(
      "Delete Client",
      "Are you sure you want to delete this client?",
      async () => {
        try {
          await API.put(`/clients/delete/${id}`);
          navigate("/clients");
        } catch (err) {
          console.error("delete client error", err);
          showAlert(
            "Delete Failed",
            err.response?.data?.message || "Failed to delete client",
            "error"
          );
        }
      },
      { confirmLabel: "Delete", variant: "danger" }
    );
  };

  const handleAddDealFromClient = () => {
    if (!id) return;
    navigate(`/leads/new?view=deal&clientId=${id}`);
  };

  const handleDeleteDeal = async () => {
    if (!dealId) {
      showAlert("Delete Failed", "Deal ID is missing.", "error");
      return;
    }

    setDealDeleteReason("");

    showConfirm(
      "Delete Deal",
      "Please provide a reason before deleting this deal.",
      async (enteredReason) => {
        const reason = String(enteredReason || "").trim();
        if (!reason) {
          showAlert("Reason Required", "Please provide a reason to delete deal.", "warning");
          return;
        }
        try {
          await API.delete(`/deals/${dealId}`, {
            data: { reason },
          });
          navigate("/deals");
        } catch (err) {
          console.error("delete deal error", err);
          showAlert(
            "Delete Failed",
            err.response?.data?.message || "Failed to delete deal",
            "error"
          );
        }
      },
      { confirmLabel: "Delete", variant: "danger", mode: "input-confirm" }
    );
  };

  const handleConvertToDeal = async () => {
    if (isNew || lead.converted_to_deal || lead.converted_deal_id) return;

    showConfirm(
      "Convert To Deal",
      "Enter the deal name for this converted lead.",
      async (enteredDealName) => {
        const dealName = String(enteredDealName || "").trim();
        if (!dealName) {
          showAlert("Deal Name Required", "Please enter a deal name.", "warning");
          return;
        }

        try {
          const response = await API.put(`/leads/${id}/convert-to-deal`, {
            deal_name: dealName,
          });
          const updatedLead = response.data?.lead || lead;
          const createdDeal = response.data?.deal || null;

          setLead((prev) => ({
            ...prev,
            ...updatedLead,
            deal_name: createdDeal?.deal_name || dealName,
          }));
          showAlert("Converted", "Lead converted to deal successfully.", "success");
        } catch (err) {
          console.error("convert lead error", err);
          showAlert(
            "Convert Failed",
            err.response?.data?.message || "Failed to convert lead",
            "error"
          );
        }
      },
      { confirmLabel: "Convert", variant: "success", mode: "input-confirm" }
    );
  };

  const handleRestoreLead = async () => {
    if (isNew) return;

    showConfirm(
      "Restore Lead",
      "Do you want to restore this deleted lead?",
      async () => {
        try {
          await API.put(`/leads/${id}/restore`);
          navigate(`/leads/${id}`);
        } catch (err) {
          console.error("restore lead error", err);
          showAlert(
            "Restore Failed",
            err.response?.data?.message || "Failed to restore lead",
            "error"
          );
        }
      },
      { confirmLabel: "Restore", variant: "success" }
    );
  };

  const handleRestoreDeal = async () => {
    if (!dealId) {
      showAlert("Restore Failed", "Deal ID is missing.", "error");
      return;
    }

    showConfirm(
      "Restore Deal",
      "Do you want to restore this deleted deal?",
      async () => {
        try {
          await API.put(`/deals/${dealId}/restore`);
          navigate("/deals");
        } catch (err) {
          console.error("restore deal error", err);
          showAlert(
            "Restore Failed",
            err.response?.data?.message || "Failed to restore deal",
            "error"
          );
        }
      },
      { confirmLabel: "Restore", variant: "success" }
    );
  };
  const handleActivateRecord = async () => {
    if (isNew) return;
    try {
      if (dealView) {
        if (!dealId) {
          showAlert("Activate Failed", "Deal ID is missing.", "error");
          return;
        }
        await API.put(`/deals/${dealId}`, { isActive: true });
      } else {
        await API.put(`/leads/${id}`, { is_active: true });
      }
      setLead((prev) => ({
        ...prev,
        isActive: true,
        is_active: true,
      }));
      showAlert("Activated", `${dealView ? "Deal" : "Lead"} activated successfully.`, "success");
    } catch (err) {
      console.error("activate record error", err);
      showAlert(
        "Activate Failed",
        err.response?.data?.message || `Failed to activate ${dealView ? "deal" : "lead"}`,
        "error"
      );
    }
  };

  const followUps = Array.isArray(lead.contact_history) ? lead.contact_history : [];
  const dealId = dealIdFromQuery || lead?.converted_deal_id || "";
  const isConvertedLead = Boolean(lead.converted_to_deal || lead.converted_deal_id);
  const isInactiveRecord = !deletedView && (lead.is_active === false || lead.isActive === false);
  const historyRows = [...followUps].sort(
    (a, b) =>
      new Date(b?.completed_at || b?.contacted_at || 0) -
      new Date(a?.completed_at || a?.contacted_at || 0)
  );
  const followupCount = Number(
    lead?.followup_count !== undefined && lead?.followup_count !== null
      ? lead.followup_count
      : historyRows.length
  );

  return (
    <div className={embedded ? "lead-page embedded-lead-page" : "lead-page"}>
      {!embedded && (
        <div className="lead-header">
          <h2>
            {isNew
              ? clientView
                ? "Add Client"
                : dealView
                  ? "Add Deal"
                  : "Add Lead"
              : clientView
                ? `Client - ${lead.company_name || "Details"}`
                : dealView
                  ? `Deal - ${lead.deal_name || lead.company_name || "Details"}`
                  : lead.company_name}
          </h2>
          <BackButton />
        </div>
      )}

      {deletedView && (
        <div className="deleted-banner" style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px 16px', borderRadius: '8px', margin: '20px 0', fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #fecaca' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          This {clientView ? "client" : dealView ? "deal" : "lead"} is currently deleted and is read-only. Please restore it to make edits.
        </div>
      )}

      {!deletedView && (lead.is_active === false || lead.isActive === false) && (
        <div className="inactive-banner" style={{ background: '#fef3c7', color: '#b45309', padding: '12px 16px', borderRadius: '8px', margin: '20px 0', fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #fde68a' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          This {clientView ? "client" : dealView ? "deal" : "lead"} is currently inactive. You cannot generate quotes for inactive sales records.
        </div>
      )}

      {hasOcrContext && ocrPreviews.length > 0 && (
        <div className="ocr-form-preview">
          <div className="ocr-form-preview-copy">
            <span className="ocr-form-preview-tag">OCR Source</span>
            <h3>Scanned Card Preview</h3>
            <p>Use these images to verify the extracted details while filling the form.</p>
          </div>
          <div className="ocr-form-preview-media">
            <div className="ocr-form-preview-switcher">
              <button
                type="button"
                className="ocr-form-preview-arrow"
                onClick={() => setSelectedOcrPreviewIndex((current) => (current - 1 + ocrPreviews.length) % ocrPreviews.length)}
                disabled={ocrPreviews.length < 2}
                aria-label="Previous OCR preview"
              >
                &lt;
              </button>
              <div className="ocr-form-preview-main">
                <img src={ocrPreviews[selectedOcrPreviewIndex] || ocrPreviews[0]} alt={`Scanned business card ${selectedOcrPreviewIndex + 1}`} />
                {ocrPreviews.length > 1 && (
                  <div className="ocr-form-preview-count">
                    {selectedOcrPreviewIndex + 1} / {ocrPreviews.length}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="ocr-form-preview-arrow"
                onClick={() => setSelectedOcrPreviewIndex((current) => (current + 1) % ocrPreviews.length)}
                disabled={ocrPreviews.length < 2}
                aria-label="Next OCR preview"
              >
                &gt;
              </button>
            </div>
            {ocrPreviews.length > 1 && (
              <div className="ocr-form-preview-thumbs">
                {ocrPreviews.map((src, idx) => (
                  <button
                    type="button"
                    key={`${src}-${idx}`}
                    className={`ocr-form-preview-thumb ${idx === selectedOcrPreviewIndex ? "active" : ""}`}
                    onClick={() => setSelectedOcrPreviewIndex(idx)}
                    aria-label={`Show preview ${idx + 1}`}
                  >
                    <img src={src} alt={`Preview ${idx + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {hasOcrContext && ocrWarning && (
        <div
          style={{
            margin: "16px 0 0",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "#fff7ed",
            color: "#9a3412",
            border: "1px solid #fdba74",
            fontWeight: 600,
          }}
        >
          {ocrWarning}
        </div>
      )}

      {/* ================= COMPANY INFO ================= */}
      <div className="lead-form">
        {(dealView || lead.deal_name) && (
          <Field
            label="Deal Name"
            name="deal_name"
            value={lead.deal_name}
            onChange={handleLeadChange}
            editMode={editMode}
          />
        )}
        <div className="field company-autocomplete-field">
          <label>Company Name</label>
          {editMode ? (
            <div className="company-autocomplete-wrapper" ref={suggestionsRef}>
              <input
                type="text"
                name="company_name"
                value={lead.company_name || ""}
                autoComplete="off"
                onChange={(e) => {
                  handleLeadChange(e);
                  if (isNew && !clientView) {
                    const val = e.target.value.trim();
                    if (companySearchTimer.current) clearTimeout(companySearchTimer.current);
                    if (val.length < 2) {
                      setCompanySuggestions([]);
                      setShowSuggestions(false);
                      return;
                    }
                    companySearchTimer.current = setTimeout(async () => {
                      try {
                        const { data } = await API.get("/leads/search-company", { params: { q: val } });
                        setCompanySuggestions(Array.isArray(data) ? data : []);
                        setShowSuggestions(true);
                      } catch (err) {
                        console.error("company search error", err);
                      }
                    }, 300);
                  }
                }}
                onFocus={() => {
                  if (companySuggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
              />
              {!clientView && showSuggestions && companySuggestions.length > 0 && (
                <ul className="company-suggestions">
                  {companySuggestions.map((s) => (
                    <li
                      key={s._id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setLead((prev) => ({
                          ...prev,
                          company_name: s.company_name,
                          industry: s.industry || prev.industry,
                          employee_count: s.employee_count || prev.employee_count,
                          turnover_range: s.turnover_range || prev.turnover_range,
                          Address: normalizeOcrAddress(s.Address || prev.Address),
                          website: s.website || prev.website,
                          source: s.source || prev.source,
                          referred_by_user: s.referred_by_user || prev.referred_by_user,
                          expo_event_id: s.expo_event_id || prev.expo_event_id,
                          deal_value_estimate: s.deal_value_estimate || prev.deal_value_estimate,
                          assigned_to: s.assigned_to || prev.assigned_to,
                          country: s.country || prev.country,
                          State: s.State || prev.State,
                          city: s.city || prev.city,
                          is_existing_company: true,
                        }));
                        setCompanySuggestions([]);
                        setShowSuggestions(false);
                        if (Array.isArray(s.contacts) && s.contacts.length > 0) {
                          setContacts(s.contacts.map((contact) => mapContactForForm(contact)));
                        }
                      }}
                    >
                      <span className="suggestion-name">{s.company_name}</span>
                      <span className="suggestion-type">{s.type === "client" ? "Client" : "Lead"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p>{lead.company_name || "-"}</p>
          )}
        </div>
        <div className="field">
          <label>Industry</label>
          {editMode ? (
            <div className="industry-autocomplete">
              <input
                type="text"
                name="industry"
                list="industry-options"
                placeholder="Start typing to search..."
                value={industryNameMap.get(String(lead.industry || "")) || lead.industry || ""}
                onChange={(e) => {
                  const value = e.target.value;
                  const match = industries.find(
                    (item) => String(item?.name || "").toLowerCase() === value.toLowerCase()
                  );
                  setLead((prev) => ({
                    ...prev,
                    industry: match ? match._id || match.name : value,
                  }));
                }}
              />
              <datalist id="industry-options">
                {industries.map((item) => (
                  <option key={item?._id || item?.name} value={item?.name} />
                ))}
              </datalist>
            </div>
          ) : (
            <p>{industryNameMap.get(String(lead.industry || "")) || lead.industry || "-"}</p>
          )}
        </div>
        <Field label="Employees" name="employee_count" value={lead.employee_count} onChange={handleLeadChange} editMode={editMode} />
        <Field label="Turnover" name="turnover_range" value={lead.turnover_range} onChange={handleLeadChange} editMode={editMode} />
        {!clientView && (
          <Field label="Value Estimate" name="deal_value_estimate" value={lead.deal_value_estimate} onChange={handleLeadChange} editMode={editMode} type="number" />
        )}

        {/* Pipeline Stage */}
        {dealView && (
          <div className="field">
            <label>Stage</label>
            {editMode ? (
              <select name="stage" value={lead.stage || "P3"} onChange={handleLeadChange}>
                {DEAL_STAGE_OPTIONS.map((stage) => (
                  <option key={stage.key} value={stage.key}>{stage.title}</option>
                ))}
              </select>
            ) : (
              <p>{getStageTitle(lead.stage || "P3", { bucket: "deal" })}</p>
            )}
          </div>
        )}

        {/* Lead Stage */}
        {!dealView && !clientView && (
          <div className="field">
            <label>Stage</label>
            {editMode ? (
              <select name="stage" value={lead.stage || "P3"} onChange={handleLeadChange}>
                {LEAD_STAGE_OPTIONS.map((stage) => (
                  <option key={stage.key} value={stage.key}>{stage.title}</option>
                ))}
              </select>
            ) : (
              <p>{getStageTitle(lead.stage || "P3", { bucket: "lead" })}</p>
            )}
          </div>
        )}
        <Field label="Address" name="Address" value={lead.Address} onChange={handleLeadChange} editMode={editMode} />

        {/* COUNTRY */}
        {!isFromOCR && (
          <div className="field">
            <label>Country</label>
            {editMode ? (
              <select name="country" value={lead.country} onChange={handleLeadChange}>
                <option value="">Select Country</option>
                {countries.map((c, i) => (
                  <option key={i} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <p>{lead.country || "-"}</p>
            )}
          </div>
        )}

        {/* STATE */}
        {!isFromOCR && (
          <div className="field">
            <label>State</label>
            {editMode ? (
              <select
                name="State"
                value={lead.State}
                onChange={handleLeadChange}
                disabled={!lead.country}
              >
                <option value="">Select State</option>
                {stateOptions.map((item, i) => (
                  <option key={item?._id || i} value={item?.State || ""}>
                    {item?.State || ""}
                  </option>
                ))}
              </select>
            ) : (
              <p>{lead.State || "-"}</p>
            )}
          </div>
        )}

        {/* CITY */}
        {!isFromOCR && (
          <div className="field">
            <label>City</label>
            {editMode ? (
              <select
                name="city"
                value={lead.city}
                onChange={handleLeadChange}
                disabled={!lead.State}
              >
                <option value="">Select City</option>
                {cityOptions.map((item, i) => (
                  <option key={item?._id || i} value={item?.city || ""}>
                    {item?.city || ""}
                  </option>
                ))}
              </select>
            ) : (
              <p>{lead.city || "-"}</p>
            )}
          </div>
        )}

        <Field label="Website" name="website" value={lead.website} onChange={handleLeadChange} editMode={editMode} />

        {/* SOURCE */}
        <div className="field">
          <label>Source</label>
          {isFromOCR ? (
            <p>OCR</p>
          ) : editMode ? (
            <div
              ref={sourceMenuRef}
              style={{ position: "relative" }}
              onMouseLeave={() => {
                setSourceSubmenu({ type: "", sourceId: "" });
                setSourceSubmenuTop(0);
              }}
            >
              <button
                type="button"
                onClick={() => setSourceMenuOpen((prev) => !prev)}
                className="crm-source-trigger"
              >
                {sourceDisplayValue === "-" ? "Select Source" : sourceDisplayValue}
              </button>
              {sourceMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    minWidth: "100%",
                    background: "#fff",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                    zIndex: 30,
                  }}
                >
                  <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                    <div
                      onClick={() => handleSourceMenuSelect("source", "")}
                      className="crm-source-menu-item"
                    >
                      Select Source
                    </div>
                    {normalSources.map((s) => (
                      <div
                        key={s._id}
                        onClick={() => handleSourceMenuSelect("source", String(s._id))}
                        className="crm-source-menu-item"
                      >
                        {s.name}
                      </div>
                    ))}
                    {referenceSources.map((sourceItem) => (
                      <div
                        key={`ref-${sourceItem._id}`}
                        onMouseEnter={(e) => {
                          setSourceSubmenu({ type: "reference", sourceId: String(sourceItem._id) });
                          setSourceSubmenuTop(e.currentTarget.offsetTop);
                        }}
                        className={`crm-source-menu-item crm-source-parent ${sourceSubmenu.type === "reference" && sourceSubmenu.sourceId === String(sourceItem._id) ? "active" : ""}`}
                      >
                        <span>{sourceItem.name}</span>
                        <span style={{ float: "right" }}>{sourceSubmenuDirection === "left" ? "<" : ">"}</span>
                      </div>
                    ))}
                    {eventExpoSources.map((sourceItem) => (
                      <div
                        key={`event-${sourceItem._id}`}
                        onMouseEnter={(e) => {
                          setSourceSubmenu({ type: "event", sourceId: String(sourceItem._id) });
                          setSourceSubmenuTop(e.currentTarget.offsetTop);
                        }}
                        className={`crm-source-menu-item crm-source-parent ${sourceSubmenu.type === "event" && sourceSubmenu.sourceId === String(sourceItem._id) ? "active" : ""}`}
                      >
                        <span>{sourceItem.name}</span>
                        <span style={{ float: "right" }}>{sourceSubmenuDirection === "left" ? "<" : ">"}</span>
                      </div>
                    ))}
                  </div>
                  {!!sourceSubmenu.type && (
                    <div
                      style={{
                        position: "absolute",
                        top: sourceSubmenuTop,
                        left: sourceSubmenuDirection === "right" ? "100%" : "auto",
                        right: sourceSubmenuDirection === "left" ? "100%" : "auto",
                        minWidth: "220px",
                        maxWidth: "260px",
                        background: "#fff",
                        border: "1px solid #d1d5db",
                        borderRadius: "8px",
                        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                        zIndex: 31,
                        maxHeight: "400px",
                        overflowY: "auto",
                      }}
                    >
                      {sourceSubmenu.type === "reference" &&
                        (users.length ? (
                          users.map((u) => (
                            <div
                              key={`${sourceSubmenu.sourceId}-${u._id}`}
                              onClick={() => handleSourceMenuSelect("reference", sourceSubmenu.sourceId, String(u._id))}
                              className="crm-source-menu-item"
                            >
                              {u.name}
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: "8px 12px", color: "#6b7280" }}>No users found</div>
                        ))}
                      {sourceSubmenu.type === "event" &&
                        (events.length ? (
                          events.map((ev) => (
                            <div
                              key={`${sourceSubmenu.sourceId}-${ev._id}`}
                              onClick={() => handleSourceMenuSelect("event", sourceSubmenu.sourceId, String(ev._id))}
                              className="crm-source-menu-item"
                            >
                              {ev.name}
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: "8px 12px", color: "#6b7280" }}>No events found</div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p>{isFromOCR ? "OCR" : sourceDisplayValue}</p>
          )}
        </div>

        {!clientView && !isFromOCR && (
          <div className="field">
            <label>{dealView ? "Assign Deal To" : "Assign Lead To"}</label>
            {editMode && isAdminOrManager ? (
              <select name="assigned_to" value={lead.assigned_to || ""} onChange={handleLeadChange}>
                <option value="">Select User</option>
                {assignableUsers.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <p>{users.find((u) => u._id === lead.assigned_to)?.name || "-"}</p>
            )}
          </div>
        )}
      </div>

      {/* ================= CONTACTS ================= */}
      <div className="contacts-section">
        <h3 className="contacts-title">Contacts</h3>

        {contacts.map((c, i) => (
          <div key={i} className="contact-card">
            <div className="contact-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {c.is_primary ? "Primary Contact" : `Contact ${i + 1}`}
                {editMode && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '14px', fontWeight: 'normal', cursor: 'pointer', marginLeft: '10px' }}>
                    <input
                      type="radio"
                      name="primary_contact_lead"
                      checked={Boolean(c.is_primary)}
                      onChange={() => {
                        const updated = contacts.map((contact, idx) => ({
                          ...contact,
                          is_primary: idx === i
                        }));
                        setContacts(updated);
                      }}
                    />
                    Set as Primary
                  </label>
                )}
              </div>
              {editMode && contacts.length > 1 && (
                <button className="remove-contact-btn" onClick={() => removeContact(i)}>
                  X
                </button>
              )}
            </div>

            <div className="contact-grid">
              <InputField label="Name" name="name" value={c.name} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField
                label="Designation"
                name="designation"
                value={c.designation}
                onChange={(e) => handleContactChange(i, e)}
                editMode={editMode}
                displayClassName="contact-designation-value"
              />
              <div className="field">
                <label>Phone</label>
                {(Array.isArray(c.phone) && c.phone.length ? c.phone : [""]).map((p, pIdx) => (
                  <div key={pIdx} style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: "8px", width: "100%" }}>
                    <div style={{ flexGrow: 1 }}>
                      {editMode ? (
                        <PhoneInput
                          international
                          defaultCountry="IN"
                          value={p || ""}
                          onChange={(val) => {
                            const updated = [...contacts];
                            if (!Array.isArray(updated[i].phone)) updated[i].phone = typeof updated[i].phone === 'string' && updated[i].phone ? updated[i].phone.split(',') : [""];
                            updated[i].phone[pIdx] = val;
                            setContacts(updated);
                          }}
                        />
                      ) : (
                        <p>{p || "-"}</p>
                      )}
                    </div>
                    {editMode && Array.isArray(c.phone) && c.phone.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...contacts];
                          updated[i].phone.splice(pIdx, 1);
                          setContacts(updated);
                        }}
                        style={{ position: "absolute", right: "10px", background: "#f3f4f6", color: "#9ca3af", border: "none", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px", fontWeight: "bold", transition: "all 0.2s", zIndex: 2 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = '#f3f4f6'; }}
                      >✕</button>
                    )}
                  </div>
                ))}
                {editMode && (
                  <button type="button" onClick={() => {
                    const updated = [...contacts];
                    if (!Array.isArray(updated[i].phone)) updated[i].phone = typeof updated[i].phone === 'string' && updated[i].phone ? updated[i].phone.split(',') : [""];
                    updated[i].phone.push("");
                    setContacts(updated);
                  }} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: "13px", fontWeight: "500", marginTop: "4px" }}>+ Add Phone</button>
                )}
              </div>
              <div className="field">
                <label>Email</label>
                {(Array.isArray(c.email) && c.email.length ? c.email : [""]).map((em, eIdx) => (
                  <div key={eIdx} style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: "8px", width: "100%" }}>
                    <div style={{ flexGrow: 1 }}>
                      {editMode ? (
                        <input type="email" style={{ width: "100%", paddingRight: Array.isArray(c.email) && c.email.length > 1 ? "36px" : "12px" }} value={em || ""} onChange={(e) => {
                          const updated = [...contacts];
                          if (!Array.isArray(updated[i].email)) updated[i].email = typeof updated[i].email === 'string' && updated[i].email ? updated[i].email.split(',') : [""];
                          updated[i].email[eIdx] = e.target.value;
                          setContacts(updated);
                        }} />
                      ) : (
                        <p>{em || "-"}</p>
                      )}
                    </div>
                    {editMode && Array.isArray(c.email) && c.email.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                            const updated = [...contacts];
                            updated[i].email.splice(eIdx, 1);
                            setContacts(updated);
                          }}
                        style={{ position: "absolute", right: "10px", background: "#f3f4f6", color: "#9ca3af", border: "none", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px", fontWeight: "bold", transition: "all 0.2s", zIndex: 2 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = '#f3f4f6'; }}
                      >✕</button>
                    )}
                  </div>
                ))}
                {editMode && (
                  <button type="button" onClick={() => {
                    const updated = [...contacts];
                    if (!Array.isArray(updated[i].email)) updated[i].email = typeof updated[i].email === 'string' && updated[i].email ? updated[i].email.split(',') : [""];
                    updated[i].email.push("");
                    setContacts(updated);
                  }} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: "13px", fontWeight: "500", marginTop: "4px" }}>+ Add Email</button>
                )}
              </div>
              {!clientView && (
                <InputField label="Address" name="address" value={c.address} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              )}
              {!isFromOCR && (
                <InputField label="LinkedIn" name="linkedin" value={c.linkedin} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              )}
            </div>
          </div>
        ))}

        {editMode && (
          <div className="add-contact-wrapper">
            <button className="add-contact-btn" onClick={addContact}>
              + Add Contact
            </button>
          </div>
        )}
      </div>

      {!clientView && !embedded && !isNew && (
        <div className="contacts-section">
          <h3 className="contacts-title">{`Follow-up History (${followupCount})`}</h3>
          {historyRows.length === 0 && <p>No follow-up history yet.</p>}
          {historyRows.map((entry, idx) => (
            <div key={`done-${idx}`} className="contact-card">
              <div className="contact-title">
                {`Follow-up #${idx + 1}`}
              </div>
              <div className="contact-grid">
                <div className="field">
                  <label>Date</label>
                  <p>
                    {(entry.contacted_at || entry.completed_at)
                      ? new Date(
                        entry.contacted_at || entry.completed_at
                      ).toLocaleString("en-IN")
                      : "-"}
                  </p>
                </div>
                <div className="field">
                  <label>Status</label>
                  <p>{String(entry.status || (entry.is_completed ? "completed" : "pending")).replace(/^./, (c) => c.toUpperCase())}</p>
                </div>
                <div className="field">
                  <label>Reply / Outcome</label>
                  <p>{entry.reply || "-"}</p>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <p>{entry.notes || "-"}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="form-actions">
        {deletedView ? (
          isAdminOrManager && (
            <button className="convert-btn restore-btn" style={{ background: '#10b981', borderColor: '#10b981' }} onClick={dealView ? handleRestoreDeal : handleRestoreLead}>
              Restore {clientView ? "Client" : dealView ? "Deal" : "Lead"}
            </button>
          )
        ) : editMode ? (
          <>
            <button className="save-btn" onClick={handleSave}>
              Save
            </button>
            {embedded && (
              <button className="edit-btn" onClick={() => onCancel?.()}>
                Back
              </button>
            )}
          </>
        ) : (
          !isNew && (
            <>
              {isInactiveRecord ? (
                <button
                  className="convert-btn restore-btn"
                  style={{ background: '#10b981', borderColor: '#10b981' }}
                  onClick={handleActivateRecord}
                >
                  Activate
                </button>
              ) : (
                <>
                  <button className="edit-btn" onClick={() => setEditMode(true)}>
                    Edit
                  </button>
                  {clientView ? (
                    <>
                      <button className="convert-btn" onClick={handleAddDealFromClient}>
                        Add Deal
                      </button>
                      {isAdminOrManager && (
                        <button className="soft-delete-btn" onClick={handleDeleteClient}>
                          Delete
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {dealView && dealId && !isAdmin && (
                        <button
                          className="convert-btn"
                          onClick={() => navigate(`/quotations/new?dealId=${dealId}`)}
                          disabled={lead.isActive === false}
                          title={lead.isActive === false ? "Cannot create quotes for inactive deals." : ""}
                        >
                          Create Quote
                        </button>
                      )}
                      {!dealView && !isConvertedLead && (
                        <button className="convert-btn" onClick={handleConvertToDeal}>
                          Convert to Deal
                        </button>
                      )}
                      {isAdminOrManager && (
                        <button
                          className="soft-delete-btn"
                          onClick={dealView ? handleDeleteDeal : handleSoftDelete}
                        >
                          {dealView ? "Delete Deal" : "Delete"}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )
        )}
      </div>

      {popup.open && (
        <div className="crm-popup-overlay">
          <div className={`crm-popup-card ${popup.variant}`}>
            <h3>{popup.title}</h3>
            <p>{popup.message}</p>
            {popup.mode === "input-confirm" && (
              <input
                className="crm-popup-input"
                type="text"
                placeholder={popup.title === "Convert To Deal" ? "Enter deal name" : "Enter delete reason"}
                value={dealDeleteReason}
                onChange={(e) => setDealDeleteReason(e.target.value)}
              />
            )}
            <div className="crm-popup-actions">
              {(popup.mode === "confirm" || popup.mode === "input-confirm") && (
                <button className="crm-popup-cancel" onClick={closePopup}>
                  {popup.cancelLabel}
                </button>
              )}
              <button className="crm-popup-confirm" onClick={handlePopupConfirm}>
                {popup.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= FIELD COMPONENTS ================= */

function Field({ label, name, value, onChange, editMode, type = "text" }) {
  return (
    <div className="field">
      <label>{label}</label>
      {editMode ? (
        <input type={type} name={name} value={value || ""} onChange={onChange} />
      ) : (
        <p>{value || "-"}</p>
      )}
    </div>
  );
}

function InputField({ label, name, value, onChange, editMode, type = "text", displayClassName = "" }) {
  return (
    <div className="field">
      <label>{label}</label>
      {editMode ? (
        <input type={type} name={name} value={value || ""} onChange={onChange} />
      ) : (
        <p className={displayClassName}>{value || "-"}</p>
      )}
    </div>
  );
}

export default LeadFormPage;
