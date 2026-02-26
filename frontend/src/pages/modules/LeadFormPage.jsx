import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import BackButton from "../../components/BackButton";

function LeadFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const isNew = id === "new" || !id;
  const searchParams = new URLSearchParams(location.search);
  const deletedView = searchParams.get("deleted") === "true";
  const dealView = searchParams.get("view") === "deal";
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
    converted_to_deal: false,
    is_existing_company: false,
    contact_history: [],
  });

  /* ================= DROPDOWNS ================= */
  const [sources, setSources] = useState([]);
  const [locations, setLocations] = useState([]);
  const [industries, setIndustries] = useState([]);

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
    const loadLead = async () => {
      if (isNew) return;

      try {
        const { data } = await API.get(`/leads/${id}`, {
          params: {
            include_deleted: deletedView,
          },
        });
        const loadedLead = data.lead || data;
        setLead({
          ...loadedLead,
          contact_history: Array.isArray(loadedLead.contact_history)
            ? loadedLead.contact_history
            : [],
        });
        if (data.contacts?.length) setContacts(data.contacts);
      } catch (err) {
        console.error("lead load error", err);
      }
    };

    loadLead();
  }, [id, isNew, deletedView]);

  /* ================= LOAD DROPDOWNS ================= */
  useEffect(() => {
    const load = async () => {
      const [sourcesRes, locationsRes, industriesRes] = await Promise.allSettled([
        API.get("/sources"),
        API.get("/location"),
        API.get("/industries"),
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
    };

    load();
  }, []);

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
        ? await API.post("/leads", payload)
        : await API.put(`/leads/${id}`, payload);

      const data = response.data;
      if (isNew) navigate(`/leads/${data._id}`);
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
    { confirmLabel = "Confirm", cancelLabel = "Cancel", variant = "warning" } = {}
  ) => {
    setPopup({
      open: true,
      mode: "confirm",
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
    closePopup();
    if (typeof action === "function") {
      await action();
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

  const followUps = Array.isArray(lead.contact_history) ? lead.contact_history : [];
  const isConvertedLead = Boolean(lead.converted_to_deal || lead.converted_deal_id);
  const pendingFollowUps = followUps
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry?.is_completed)
    .sort((a, b) => {
      const aDate = a.entry?.next_action_date ? new Date(a.entry.next_action_date) : null;
      const bDate = b.entry?.next_action_date ? new Date(b.entry.next_action_date) : null;
      const aHasDate = aDate && !Number.isNaN(aDate.getTime());
      const bHasDate = bDate && !Number.isNaN(bDate.getTime());

      if (aHasDate && bHasDate) return aDate - bDate;
      if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;

      return new Date(b.entry?.contacted_at || 0) - new Date(a.entry?.contacted_at || 0);
    });

  const completedFollowUps = followUps
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.is_completed)
    .sort(
      (a, b) =>
        new Date(b.entry?.completed_at || b.entry?.contacted_at || 0) -
        new Date(a.entry?.completed_at || a.entry?.contacted_at || 0)
    );

  return (
    <div className="lead-page">
      <BackButton />
      <div className="lead-header">
        <h2>
          {isNew ? "Add Lead" : dealView ? `Deal - ${lead.company_name || "Details"}` : lead.company_name}
        </h2>
      </div>

      {/* ================= COMPANY INFO ================= */}
      <div className="lead-form">
        <Field label="Company Name" name="company_name" value={lead.company_name} onChange={handleLeadChange} editMode={editMode} />
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
      </div>

      <div className="contacts-section">
        <h3 className="contacts-title">Follow-up Details</h3>

        {pendingFollowUps.length === 0 && (
          <p>No pending follow-ups.</p>
        )}

        {pendingFollowUps.map(({ entry, index }) => (
            <div key={index} className="contact-card">
              <div className="contact-title">
                Follow-up #{index + 1}
                {editMode && (
                  <button
                    className="remove-contact-btn"
                    onClick={() => removeHistoryEntry(index)}
                  >
                    X
                  </button>
                )}
              </div>

              <div className="contact-grid">
                <div className="field">
                  <label>Date & Time</label>
                  {editMode ? (
                    <input
                      type="datetime-local"
                      value={
                        asDateTimeInputValue(entry.contacted_at)
                      }
                      onChange={(e) =>
                        handleHistoryChange(index, "contacted_at", e.target.value)
                      }
                    />
                  ) : (
                    <p>
                      {entry.contacted_at
                        ? new Date(entry.contacted_at).toLocaleString("en-IN")
                        : "-"}
                    </p>
                  )}
                </div>

                <div className="field">
                  <label>Mode</label>
                  {editMode ? (
                    <select
                      value={entry.mode || "call"}
                      onChange={(e) =>
                        handleHistoryChange(index, "mode", e.target.value)
                      }
                    >
                      <option value="call">Call</option>
                      <option value="email">Email</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="meeting">Meeting</option>
                      <option value="demo">Demo</option>
                      <option value="other">Other</option>
                    </select>
                  ) : (
                    <p>{entry.mode || "-"}</p>
                  )}
                </div>

                <InputField
                  label="Reply / Outcome"
                  name="reply"
                  value={entry.reply}
                  onChange={(e) =>
                    handleHistoryChange(index, "reply", e.target.value)
                  }
                  editMode={editMode}
                />
                <InputField
                  label="Notes"
                  name="notes"
                  value={entry.notes}
                  onChange={(e) =>
                    handleHistoryChange(index, "notes", e.target.value)
                  }
                  editMode={editMode}
                />
                <div className="field">
                  <label>Status</label>
                  {editMode ? (
                    <label className="followup-done-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(entry.is_completed)}
                        onChange={(e) =>
                          handleFollowUpCompleted(index, e.target.checked)
                        }
                      />
                      Mark Done
                    </label>
                  ) : (
                    <p>Pending</p>
                  )}
                </div>
              </div>
            </div>
          ))}

        {editMode && (
          <div className="add-contact-wrapper">
            <button className="add-contact-btn" onClick={addHistoryEntry}>
              + Add Next Task
            </button>
          </div>
        )}
      </div>

      <div className="contacts-section">
        <h3 className="contacts-title">Follow-up History</h3>
        {completedFollowUps.length === 0 && <p>No completed follow-ups yet.</p>}
        {completedFollowUps.map(({ entry }, idx) => (
          <div key={`done-${idx}`} className="contact-card">
            <div className="contact-title">
              Completed Follow-up #{idx + 1}
            </div>
            <div className="contact-grid">
              <div className="field">
                <label>Completed At</label>
                <p>
                  {entry.completed_at
                    ? new Date(entry.completed_at).toLocaleString("en-IN")
                    : "-"}
                </p>
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

      <div className="form-actions">
        {deletedView ? (
          !editMode && !isNew && (
            <button className="convert-btn" onClick={handleRestoreLead}>
              Restore
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
              {!dealView && !isConvertedLead && (
                <button className="convert-btn" onClick={handleConvertToDeal}>
                  Convert to Deal
                </button>
              )}
              <button className="soft-delete-btn" onClick={handleSoftDelete}>
                Delete
              </button>
            </>
          )
        )}
      </div>

      {popup.open && (
        <div className="crm-popup-overlay">
          <div className={`crm-popup-card ${popup.variant}`}>
            <h3>{popup.title}</h3>
            <p>{popup.message}</p>
            <div className="crm-popup-actions">
              {popup.mode === "confirm" && (
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
