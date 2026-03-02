import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import API from "../../api";
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

function LeadFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdminOrManager = roleName === "admin" || roleName === "manager";
  const currentUserId = getUserIdFromToken();
  const currentUserName = String(localStorage.getItem("Name") || "");

  const isNew = id === "new" || !id;
  const searchParams = new URLSearchParams(location.search);
  const deletedView = searchParams.get("deleted") === "true";
  const dealView = searchParams.get("view") === "deal";
  const dealIdFromQuery = searchParams.get("dealId") || "";
  const shouldStartInEditMode =
    !deletedView && (isNew || searchParams.get("edit") === "true");
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
  const [industries, setIndustries] = useState([]);
  const [users, setUsers] = useState([]);

  /* ================= CONTACTS ================= */
  const [contacts, setContacts] = useState([
    {
      name: "",
      designation: "",
      phone: "",
      email: "",
      linkedin: "",
      address: "",
      is_primary: true,
    },
  ]);

  /* ================= LOAD LEAD ================= */
  useEffect(() => {
    const loadData = async () => {
      if (isNew) return;

      try {
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
  }, [id, isNew, deletedView, dealView, dealIdFromQuery]);
  /* ================= LOAD DROPDOWNS ================= */
  useEffect(() => {
    const load = async () => {
      const [sourcesRes, locationsRes, industriesRes, usersRes] = await Promise.allSettled([
        API.get("/sources"),
        API.get("/location"),
        API.get("/industries"),
        API.get("/users"),
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
        setIndustries(
          (Array.isArray(industriesRes.value.data) ? industriesRes.value.data : [])
            .map((item) => item?.name)
            .filter(Boolean)
        );
      } else {
        console.error("industries load error", industriesRes.reason);
      }

      if (usersRes.status === "fulfilled") {
        setUsers(Array.isArray(usersRes.value.data) ? usersRes.value.data : []);
      } else {
        console.error("users load error", usersRes.reason);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!isNew || isAdminOrManager || !currentUserId) return;
    setLead((prev) => ({
      ...prev,
      assigned_to: prev.assigned_to || currentUserId,
    }));
  }, [isNew, isAdminOrManager, currentUserId]);

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

      return updated;
    });
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
    if (!contacts[0].name || !contacts[0].phone) {
      showAlert("Validation", "Primary contact required", "error");
      return;
    }

    const payload = {
      ...lead,
      contacts,
    };

    try {
      const response = isNew
        ? await API.post(dealView ? "/leads?create_as_deal=true" : "/leads", payload)
        : await API.put(`/leads/${id}`, payload);

      const data = response.data;
      if (isNew) {
        if (dealView && data.deal) {
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

  const states = [
    ...new Set(
      locations
        .filter((l) => l.country === lead.country)
        .map((l) => l.State)
    ),
  ];

  const cities = [
    ...new Set(
      locations
        .filter((l) => l.State === lead.State)
        .map((l) => l.city)
    ),
  ];

  const zones = [
    ...new Set(
      locations
        .filter((l) => l.city === lead.city)
        .map((l) => l.zone)
    ),
  ];

  const asDateInputValue = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  };

  const asDateTimeInputValue = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 16);
  };

  const handleFollowUpCompleted = (index, checked) => {
    setLead((prev) => {
      const history = Array.isArray(prev.contact_history)
        ? [...prev.contact_history]
        : [];
      history[index] = {
        ...(history[index] || {}),
        is_completed: checked,
        completed_at: checked ? new Date().toISOString() : "",
      };
      return { ...prev, contact_history: history };
    });
  };

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

  const followUps = Array.isArray(lead.contact_history) ? lead.contact_history : [];
  const dealId = dealIdFromQuery || lead?.converted_deal_id || "";
  const isConvertedLead = Boolean(lead.converted_to_deal || lead.converted_deal_id);
  const historyRows = [...followUps].sort(
    (a, b) =>
      new Date(b?.completed_at || b?.contacted_at || 0) -
      new Date(a?.completed_at || a?.contacted_at || 0)
  );

  return (
    <div className="lead-page">
      <div className="lead-header">
        <h2>
          {isNew ? (dealView ? "Add Deal" : "Add Lead") : dealView ? `Deal - ${lead.company_name || "Details"}` : lead.company_name}
        </h2>
        <BackButton />
      </div>

      {deletedView && (
        <div className="deleted-banner" style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px 16px', borderRadius: '8px', margin: '20px 0', fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #fecaca' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          This {dealView ? "deal" : "lead"} is currently deleted and is read-only. Please restore it to make edits.
        </div>
      )}

      {!deletedView && (lead.is_active === false || lead.isActive === false) && (
        <div className="inactive-banner" style={{ background: '#fef3c7', color: '#b45309', padding: '12px 16px', borderRadius: '8px', margin: '20px 0', fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #fde68a' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          This {dealView ? "deal" : "lead"} is currently inactive. You cannot generate quotes for inactive sales records.
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
                  if (isNew) {
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
              {showSuggestions && companySuggestions.length > 0 && (
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
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          ) : (
            <p>{lead.industry || "-"}</p>
          )}
        </div>
        <Field label="Employees" name="employee_count" value={lead.employee_count} onChange={handleLeadChange} editMode={editMode} />
        <Field label="Turnover" name="turnover_range" value={lead.turnover_range} onChange={handleLeadChange} editMode={editMode} />
        <Field label="Value Estimate" name="deal_value_estimate" value={lead.deal_value_estimate} onChange={handleLeadChange} editMode={editMode} type="number" />
        <Field label="Address" name="Address" value={lead.Address} onChange={handleLeadChange} editMode={editMode} />

        {/* COUNTRY */}
        <div className="field">
          <label>Country</label>
          <select name="country" value={lead.country} onChange={handleLeadChange}>
            <option value="">Select Country</option>
            {countries.map((c, i) => (
              <option key={i} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* STATE */}
        <div className="field">
          <label>State</label>
          <select
            name="State"
            value={lead.State}
            onChange={handleLeadChange}
            disabled={!lead.country}
          >
            <option value="">Select State</option>
            {states.map((s, i) => (
              <option key={i} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* CITY */}
        <div className="field">
          <label>City</label>
          <select
            name="city"
            value={lead.city}
            onChange={handleLeadChange}
            disabled={!lead.State}
          >
            <option value="">Select City</option>
            {cities.map((c, i) => (
              <option key={i} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* ZONE */}
        <div className="field">
          <label>Zone</label>
          <select
            name="zone"
            value={lead.zone}
            onChange={handleLeadChange}
            disabled={!lead.city}
          >
            <option value="">Select Zone</option>
            {zones.map((z, i) => (
              <option key={i} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <Field label="Website" name="website" value={lead.website} onChange={handleLeadChange} editMode={editMode} />

        {/* SOURCE */}
        <div className="field">
          <label>Source</label>
          {editMode ? (
            <select name="source" value={lead.source || ""} onChange={handleLeadChange}>
              <option value="">Select Source</option>
              {sources.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <p>{sources.find((s) => s._id === lead.source)?.name || "-"}</p>
          )}
        </div>

        <div className="field">
          <label>Assign Lead To</label>
          {editMode && isAdminOrManager ? (
            <select name="assigned_to" value={lead.assigned_to || ""} onChange={handleLeadChange}>
              <option value="">Select User</option>
              {users.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            <p>
              {users.find((u) => u._id === lead.assigned_to)?.name ||
                (lead.assigned_to === currentUserId ? currentUserName : "-")}
            </p>
          )}
        </div>
      </div>

      {/* ================= CONTACTS ================= */}
      <div className="contacts-section">
        <h3 className="contacts-title">Contacts</h3>

        {contacts.map((c, i) => (
          <div key={i} className="contact-card">
            <div className="contact-title">
              {c.is_primary ? "Primary Contact" : `Contact ${i + 1}`}
              {editMode && contacts.length > 1 && (
                <button className="remove-contact-btn" onClick={() => removeContact(i)}>
                  X
                </button>
              )}
            </div>

            <div className="contact-grid">
              <InputField label="Name" name="name" value={c.name} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="Designation" name="designation" value={c.designation} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="Phone" name="phone" value={c.phone} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="Email" name="email" value={c.email} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="LinkedIn" name="linkedin" value={c.linkedin} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
              <InputField label="Address" name="address" value={c.address} onChange={(e) => handleContactChange(i, e)} editMode={editMode} />
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

      <div className="form-actions">
        {deletedView ? (
          isAdminOrManager && (
            <button className="convert-btn restore-btn" style={{ background: '#10b981', borderColor: '#10b981' }} onClick={dealView ? handleRestoreDeal : handleRestoreLead}>
              Restore {dealView ? "Deal" : "Lead"}
            </button>
          )
        ) : editMode ? (
          <button className="save-btn" onClick={handleSave}>
            Save
          </button>
        ) : (
          !isNew && (
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
