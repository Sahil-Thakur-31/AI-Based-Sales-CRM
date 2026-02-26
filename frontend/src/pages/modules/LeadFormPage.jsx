import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

function LeadFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const isNew = id === "new" || !id;
  const [editMode, setEditMode] = useState(isNew);

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
    converted_to_deal: "No",
    is_existing_company: "No",
  });

  /* ================= DROPDOWNS ================= */
  const [sources, setSources] = useState([]);
  const [locations, setLocations] = useState([]);

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
    if (!isNew) {
      fetch(`/api/leads/${id}`)
        .then((res) => res.json())
        .then((data) => {
          setLead(data.lead || data);
          if (data.contacts?.length) setContacts(data.contacts);
        });
    }
  }, [id]);

  /* ================= LOAD DROPDOWNS ================= */
  useEffect(() => {
    const load = async () => {
      try {
        const [s, l] = await Promise.all([
          fetch("/api/sources"),
          fetch("/api/location"),
        ]);

        setSources(await s.json());
        setLocations(await l.json());
      } catch (err) {
        console.error("dropdown load error", err);
      }
    };
    load();
  }, []);

  /* ================= CHANGE ================= */
  const handleLeadChange = (e) => {
  const { name, value } = e.target;

  setLead(prev => {
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
      alert("Primary contact required");
      return;
    }

    const payload = { ...lead, contacts };

    const res = await fetch(
      isNew ? "/api/leads" : `/api/leads/${id}`,
      {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json();
    if (isNew) navigate(`/leads/${data._id}`);
    setEditMode(false);
  };

  /* ================= LOCATION FILTERS ================= */

const countries = [...new Set(locations.map(l => l.country))];

const states = [
  ...new Set(
    locations
      .filter(l => l.country === lead.country)
      .map(l => l.state)   // 👈 lowercase
  )
];

const cities = [
  ...new Set(
    locations
      .filter(l => l.state === lead.State)
      .map(l => l.city)
  )
];

const zones = [
  ...new Set(
    locations
      .filter(l => l.city === lead.city)
      .map(l => l.zone)
  )
];

  return (
    <div className="lead-page">

      <div className="lead-header">
        <h2>{isNew ? "Add Lead" : lead.company_name}</h2>
        {!editMode && (
          <button className="edit-btn" onClick={() => setEditMode(true)}>
            Edit
          </button>
        )}
      </div>

      {/* ================= COMPANY INFO ================= */}
      <div className="lead-form">

        <Field label="Company Name" name="company_name" value={lead.company_name} onChange={handleLeadChange} editMode={editMode}/>
        <Field label="Industry" name="industry" value={lead.industry} onChange={handleLeadChange} editMode={editMode}/>
        <Field label="Employees" name="employee_count" value={lead.employee_count} onChange={handleLeadChange} editMode={editMode}/>
        <Field label="Turnover" name="turnover_range" value={lead.turnover_range} onChange={handleLeadChange} editMode={editMode}/>
        <Field label="Address" name="Address" value={lead.Address} onChange={handleLeadChange} editMode={editMode}/>
        

       {/* COUNTRY */}
<div className="field">
  <label>Country</label>
  <select
    name="country"
    value={lead.country}
    onChange={handleLeadChange}
  >
    <option value="">Select Country</option>
    {countries.map((c, i) => (
      <option key={i} value={c}>{c}</option>
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
      <option key={i} value={s}>{s}</option>
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
      <option key={i} value={c}>{c}</option>
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
      <option key={i} value={z}>{z}</option>
    ))}
  </select>
</div>
<Field label="Website" name="website" value={lead.website} onChange={handleLeadChange} editMode={editMode}/>

        {/* SOURCE */}
        <div className="field">
          <label>Source</label>
          {editMode ? (
            <select name="source" value={lead.source || ""} onChange={handleLeadChange}>
              <option value="">Select Source</option>
              {sources.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <p>{sources.find(s => s._id === lead.source)?.name || "-"}</p>
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
                <button className="remove-contact-btn" onClick={() => removeContact(i)}>✖</button>
              )}
            </div>

            <div className="contact-grid">
              <InputField label="Name" name="name" value={c.name} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
              <InputField label="Designation" name="designation" value={c.designation} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
              <InputField label="Phone" name="phone" value={c.phone} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
              <InputField label="Email" name="email" value={c.email} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
              <InputField label="LinkedIn" name="linkedin" value={c.linkedin} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
              <InputField label="Address" name="address" value={c.address} onChange={(e)=>handleContactChange(i,e)} editMode={editMode}/>
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

      {editMode && (
        <div className="form-actions">
          <button className="save-btn" onClick={handleSave}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= FIELD COMPONENTS ================= */

function Field({ label, name, value, onChange, editMode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {editMode ? (
        <input name={name} value={value || ""} onChange={onChange}/>
      ) : (
        <p>{value || "-"}</p>
      )}
    </div>
  );
}

function InputField({ label, name, value, onChange, editMode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {editMode ? (
        <input name={name} value={value || ""} onChange={onChange}/>
      ) : (
        <p>{value || "-"}</p>
      )}
    </div>
  );
}

export default LeadFormPage;