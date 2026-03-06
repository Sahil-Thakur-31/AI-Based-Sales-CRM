import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import BackButton from "../../components/BackButton";
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

function LeadFormPage({ formMode = "", embedded = false, forcedView = "", onCancel = null, onSaved = null }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdminOrManager = roleName === "admin" || roleName === "manager";
  const currentUserId = getUserIdFromToken();

  const isNew = embedded ? true : id === "new" || !id;
  const searchParams = new URLSearchParams(location.search);
  const deletedView = embedded ? false : searchParams.get("deleted") === "true";
  const dealView = embedded ? forcedView === "deal" : searchParams.get("view") === "deal";
  const clientView = formMode === "client" || searchParams.get("view") === "client";
  const dealIdFromQuery = searchParams.get("dealId") || (dealView ? String(id || "") : "");
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

  const [lead, setLead] = useState({
    company_name: "",
    industry: "",
    employee_count: "",
    turnover_range: "",
    Address: "",
    website: "",
    source: "",
    referred_by_user: "",
    expo_event_id: "",
    country: "",
    State: "",
    city: "",
    zone: "",
    lead_temperature: "cold",
    deal_value_estimate: "",
    status: "new",
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
  const [zoneOptions, setZoneOptions] = useState([]);
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
  const [contacts, setContacts] = useState([
    {
      name: "",
      designation: "",
      phone: "",
      email: "",
      linkedin: "",
      is_primary: true,
    },
  ]);

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
            Address: loadedClient?.Address || "",
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
            zone:
              loadedClient?.zone ||
              loadedClient?.area ||
              loadedLocation?.zone ||
              loadedLocation?.area ||
              "",
            location: loadedClient?.location?._id || loadedClient?.location || "",
            contact_history: [],
            assigned_to: "",
          }));

          if (Array.isArray(data?.contacts)) {
            const mappedContacts = data.contacts.map((contact) => ({
              _id: contact?._id || "",
              name: contact?.name || "",
              designation: contact?.designation || "",
              phone: contact?.phone || "",
              email: contact?.email || "",
              linkedin: contact?.linkedin || "",
              is_primary: Boolean(contact?.is_primary),
              is_active: contact?.is_active !== false,
            }));
            setContacts(
              mappedContacts.length
                ? mappedContacts
                : [
                    {
                      name: "",
                      designation: "",
                      phone: "",
                      email: "",
                      linkedin: "",
                      is_primary: true,
                    },
                  ]
            );
          }

          return;
        }
        // 🔹 If viewing deal → load deal
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

          if (data.contacts?.length) setContacts(data.contacts);

          return;
        }

        // 🔹 Otherwise load lead
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

        if (data.contacts?.length) setContacts(data.contacts);

      } catch (err) {
        console.error("load error", err);
      }
    };

    loadData();
  }, [id, isNew, deletedView, dealView, dealIdFromQuery, clientView]);
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
        setZoneOptions([]);
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
        setZoneOptions([]);
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
    const loadZones = async () => {
      if (!lead.country || !lead.State || !lead.city) {
        setZoneOptions([]);
        return;
      }
      try {
        const { data } = await API.get("/location", {
          params: { country: lead.country, State: lead.State, city: lead.city },
        });
        setZoneOptions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("zones load error", err);
        setZoneOptions([]);
      }
    };

    loadZones();
  }, [lead.country, lead.State, lead.city]);

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
        updated.zone = "";
      }

      if (name === "State") {
        updated.city = "";
        updated.zone = "";
      }

      if (name === "city") {
        updated.zone = "";
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
        phone: "",
        email: "",
        linkedin: "",
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
    if (!contacts[0].name || !contacts[0].phone) {
      showAlert("Validation", "Primary contact required", "error");
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
          name: lead.company_name || "",
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
          contacts: contacts.map((contact) => ({
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
          contacts,
        };

        response = isNew
          ? await API.post(dealView ? "/leads?create_as_deal=true" : "/leads", payload)
          : await API.put(`/leads/${id}`, payload);
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
          navigate(`/leads/${data.lead._id}?view=deal&dealId=${data.deal._id}`);
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
    const selectedZone = zoneOptions.find((item) => item?.zone === lead.zone);
    return selectedZone?._id || null;
  }, [zoneOptions, lead.zone]);

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

    try {
      const response = await API.put(`/leads/${id}/convert-to-deal`);
      const updatedLead = response.data?.lead || lead;

      setLead((prev) => ({
        ...prev,
        ...updatedLead,
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
                  ? `Deal - ${lead.company_name || "Details"}`
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

      {/* ================= COMPANY INFO ================= */}
      <div className="lead-form">
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
                          Address: s.Address || prev.Address,
                          website: s.website || prev.website,
                          source: s.source || prev.source,
                          referred_by_user: s.referred_by_user || prev.referred_by_user,
                          expo_event_id: s.expo_event_id || prev.expo_event_id,
                          deal_value_estimate: s.deal_value_estimate || prev.deal_value_estimate,
                          lead_temperature: s.lead_temperature || prev.lead_temperature,
                          assigned_to: s.assigned_to || prev.assigned_to,
                          country: s.country || prev.country,
                          State: s.State || prev.State,
                          city: s.city || prev.city,
                          zone: s.zone || prev.zone,
                          is_existing_company: true,
                        }));
                        setCompanySuggestions([]);
                        setShowSuggestions(false);
                        if (Array.isArray(s.contacts) && s.contacts.length > 0) {
                          setContacts(s.contacts);
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
            <select name="industry" value={lead.industry || ""} onChange={handleLeadChange}>
              <option value="">Select Industry</option>
              {industries.map((item) => (
                <option key={item?._id || item?.name} value={clientView ? item?._id : item?.name}>
                  {item?.name}
                </option>
              ))}
            </select>
          ) : (
            <p>{industryNameMap.get(String(lead.industry || "")) || lead.industry || "-"}</p>
          )}
        </div>
        <Field label="Employees" name="employee_count" value={lead.employee_count} onChange={handleLeadChange} editMode={editMode} />
        <Field label="Turnover" name="turnover_range" value={lead.turnover_range} onChange={handleLeadChange} editMode={editMode} />
        {!clientView && (
          <Field label="Value Estimate" name="deal_value_estimate" value={lead.deal_value_estimate} onChange={handleLeadChange} editMode={editMode} type="number" />
        )}
        <Field label="Address" name="Address" value={lead.Address} onChange={handleLeadChange} editMode={editMode} />

        {/* COUNTRY */}
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

        {/* STATE */}
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

        {/* CITY */}
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

        {/* ZONE */}
        <div className="field">
          <label>Zone</label>
          {editMode ? (
            <select
              name="zone"
              value={lead.zone}
              onChange={handleLeadChange}
              disabled={!lead.city}
            >
              <option value="">Select Zone</option>
              {zoneOptions.map((item, i) => (
                <option key={item?._id || i} value={item?.zone || ""}>
                  {item?.zone || ""}
                </option>
              ))}
            </select>
          ) : (
            <p>{lead.zone || "-"}</p>
          )}
        </div>
        <Field label="Website" name="website" value={lead.website} onChange={handleLeadChange} editMode={editMode} />

        {/* SOURCE */}
        <div className="field">
          <label>Source</label>
          {editMode ? (
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
            <p>{sourceDisplayValue}</p>
          )}
        </div>

        {!clientView && (
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
              <InputField label="Designation" name="designation" value={c.designation} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <div className="field">
                <label>Phone</label>
                {editMode ? (
                  <PhoneInput
                    international
                    defaultCountry="IN"
                    value={c.phone || ""}
                    onChange={(val) => {
                      const updated = [...contacts];
                      updated[i].phone = val;
                      setContacts(updated);
                    }}
                  />
                ) : (
                  <p>{c.phone || "-"}</p>
                )}
              </div>
              <InputField label="Email" name="email" value={c.email} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="LinkedIn" name="linkedin" value={c.linkedin} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
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
          <h3 className="contacts-title">Follow-up History</h3>
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
                  <p>{entry.is_completed ? "Completed" : "Pending"}</p>
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
                  {dealView && dealId && (
                    <button
                      className="convert-btn"
                      onClick={() => navigate(`/quotations/new?dealId=${dealId}`)}
                      disabled={lead.isActive === false}
                      title={lead.isActive === false ? "Cannot create quotes for inactive deals." : ""}
                    >
                      Create Quote
                    </button>
                  )}
                  {!clientView && !dealView && !isConvertedLead && (
                    <button className="convert-btn" onClick={handleConvertToDeal}>
                      Convert to Deal
                    </button>
                  )}
                  {isAdminOrManager && !clientView && (
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
                placeholder="Enter delete reason"
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

function InputField({ label, name, value, onChange, editMode, type = "text" }) {
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

export default LeadFormPage;
