import { useEffect, useRef, useState } from "react";
import API from "../../../api";
import "./admin-config.css";

function createEmptyContact() {
  return {
    _localId: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    designation: "",
    phone: "",
    email: "",
    is_active: true
  };
}

function createEmptyForm() {
  return {
    name: "",
    logoUrl: "",
    address: "",
    area: "",
    city: "",
    pincode: "",
    district: "",
    state: "",
    country: "",
    panNumber: "",
    cinNumber: "",
    gstNumber: "",
    contacts: [createEmptyContact()]
  };
}

export default function Organization() {
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [metrics, setMetrics] = useState({
    employeesCount: 0,
    clientsCount: 0,
    dealsCount: 0
  });
  const [form, setForm] = useState(createEmptyForm());
  const [snapshot, setSnapshot] = useState(createEmptyForm());
  const [logoFile, setLogoFile] = useState(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");

  const resolveLogoUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("blob:")) {
      return raw;
    }
    const normalized = raw.replace(/\\/g, "/");
    const base = String(API.defaults.baseURL || "").replace(/\/?$/, "/");
    try {
      return new URL(normalized, base).toString();
    } catch (err) {
      return `${String(API.defaults.baseURL || "").replace(/\/$/, "")}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
    }
  };

  const withCacheBust = (url) => {
    if (!url || url.startsWith("blob:")) return url || "";
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}v=${Date.now()}`;
  };

  const mapProfileToForm = (profile) => ({
    name: profile?.name || "",
    logoUrl: profile?.logoUrl || "",
    address: profile?.address || "",
    area: profile?.area || "",
    city: profile?.city || "",
    pincode: profile?.pincode || "",
    district: profile?.district || "",
    state: profile?.state || "",
    country: profile?.country || "",
    panNumber: profile?.panNumber || "",
    cinNumber: profile?.cinNumber || "",
    gstNumber: profile?.gstNumber || "",
    contacts:
      Array.isArray(profile?.contacts) && profile.contacts.length
        ? profile.contacts.map((contact) => ({
            _localId: contact._id || `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: contact.name || "",
            designation: contact.designation || "",
            phone: contact.phone || "",
            email: contact.email || "",
            is_active: contact.is_active !== false
          }))
        : [createEmptyContact()]
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await API.get("/organizations/profile");
      const profile = res.data?.organization || null;
      const stats = res.data?.stats || {};

      setMetrics({
        employeesCount: Number(stats.employeesCount || profile?.employeesCount || 0),
        clientsCount: Number(stats.clientsCount || profile?.clientsCount || 0),
        dealsCount: Number(stats.dealsCount || profile?.dealsCount || 0)
      });

      const mapped = mapProfileToForm(profile);
      setForm(mapped);
      setSnapshot(mapped);
      setLogoPreview(withCacheBust(resolveLogoUrl(mapped.logoUrl || "")));
      setLogoFile(null);
      setLogoRemoved(false);
    } catch (err) {
      console.error("Failed to fetch organization profile", err);
      setError(err.response?.data?.message || "Failed to load organization profile");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = () => {
    setIsEditing(true);
    setSuccess("");
    setError("");
    setLogoRemoved(false);
  };

  const cancelEdit = () => {
    setForm(snapshot);
    setLogoPreview(withCacheBust(resolveLogoUrl(snapshot.logoUrl || "")));
    setLogoFile(null);
    setLogoRemoved(false);
    setIsEditing(false);
    setSuccess("");
    setError("");
  };

  const updateField = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const updateContact = (index, field, value) => {
    setForm((prev) => {
      const next = [...prev.contacts];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, contacts: next };
    });
  };

  const addContact = () => {
    setForm((prev) => ({
      ...prev,
      contacts: [...prev.contacts, createEmptyContact()]
    }));
  };

  const removeContact = (index) => {
    setForm((prev) => {
      if (prev.contacts.length === 1) return prev;
      return {
        ...prev,
        contacts: prev.contacts.filter((_, rowIndex) => rowIndex !== index)
      };
    });
  };

  const lookupPincode = async () => {
    const code = String(form.pincode || "").trim();
    if (!code) return;

    try {
      setPincodeLoading(true);
      const res = await API.get(`/location/pincode/${encodeURIComponent(code)}`);
      const row = res.data || {};

      setForm((prev) => ({
        ...prev,
        area: row.area || prev.area,
        city: row.city || prev.city,
        district: row.district || prev.district,
        state: row.state || prev.state,
        country: row.country || prev.country
      }));
    } catch (err) {
      if (err.response?.status === 404) {
        setError("Pincode not found in location master");
      } else {
        setError(err.response?.data?.message || "Failed to fetch pincode details");
      }
    } finally {
      setPincodeLoading(false);
    }
  };

  const handleChangeLogo = () => {
    if (!isEditing) return;
    fileInputRef.current?.click();
  };

  const handleLogoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setLogoFile(file);
    if (file) {
      setLogoPreview(URL.createObjectURL(file));
      setLogoRemoved(false);
    }
  };

  const handleDeleteLogo = () => {
    if (!isEditing) return;
    setLogoFile(null);
    setLogoRemoved(true);
    setLogoPreview("");
    setForm((prev) => ({ ...prev, logoUrl: "" }));
  };

  const saveProfile = async () => {
    try {
      if (!form.name.trim()) {
        alert("Organization name is required");
        return;
      }

      setSaving(true);
      setError("");
      setSuccess("");

      const payload = new FormData();
      payload.append("name", form.name || "");
      payload.append("logoUrl", form.logoUrl || "");
      payload.append("removeLogo", logoRemoved ? "true" : "false");
      payload.append("address", form.address || "");
      payload.append("area", form.area || "");
      payload.append("city", form.city || "");
      payload.append("pincode", form.pincode || "");
      payload.append("district", form.district || "");
      payload.append("state", form.state || "");
      payload.append("country", form.country || "");
      payload.append("panNumber", form.panNumber || "");
      payload.append("cinNumber", form.cinNumber || "");
      payload.append("gstNumber", form.gstNumber || "");
      payload.append(
        "contacts",
        JSON.stringify(
          (form.contacts || []).map((contact) => ({
            name: contact.name || "",
            designation: contact.designation || "",
            phone: contact.phone || "",
            email: contact.email || "",
            is_active: contact.is_active !== false
          }))
        )
      );

      if (logoFile) payload.append("logo", logoFile);

      const res = await API.put("/organizations/profile", payload);
      const org = res.data?.organization || null;
      const stats = res.data?.stats || {};

      setMetrics({
        employeesCount: Number(stats.employeesCount || metrics.employeesCount),
        clientsCount: Number(stats.clientsCount || metrics.clientsCount),
        dealsCount: Number(stats.dealsCount || metrics.dealsCount)
      });

      if (org) {
        const savedProfile = mapProfileToForm(org);
        setForm(savedProfile);
        setSnapshot(savedProfile);
        setLogoPreview(withCacheBust(resolveLogoUrl(savedProfile.logoUrl || "")));
        setLogoFile(null);
        setLogoRemoved(false);
      }

      setSuccess("Organization profile saved successfully");
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save organization profile", err);
      setError(err.response?.data?.message || "Failed to save organization profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-config-page">
      <div className="org-metric-row">
        <div className="org-metric-card">
          <span>Employees</span>
          <strong>{metrics.employeesCount}</strong>
        </div>
        <div className="org-metric-card">
          <span>Clients</span>
          <strong>{metrics.clientsCount}</strong>
        </div>
        <div className="org-metric-card">
          <span>Deals</span>
          <strong>{metrics.dealsCount}</strong>
        </div>
      </div>

      <div className="org-profile-shell">
        <div className="org-profile-header">
          <h3>Organization Profile</h3>
          {!loading && (
            <div className="org-profile-header-actions">
              {isEditing ? (
                <>
                  <button className="admin-config-btn" onClick={saveProfile} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="admin-config-btn org-btn-secondary" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="admin-config-btn" onClick={startEdit}>
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? <div className="admin-config-empty">Loading profile...</div> : null}
        {error ? <div className="quote-form-error">{error}</div> : null}
        {success ? <div className="org-success-banner">{success}</div> : null}

        {!loading && (
          <>
          <div className="org-profile-layout">
            <aside className="org-logo-column">
              <div className="org-logo-block org-logo-block-fixed">
                {logoPreview ? (
                  <img className="org-logo-preview org-logo-preview-large" src={logoPreview} alt="Organization logo" />
                ) : (
                  <div className="org-logo-preview-empty org-logo-preview-empty-large">No logo uploaded</div>
                )}
              </div>

              {isEditing && (
                <div className="org-logo-actions">
                  <input
                    ref={fileInputRef}
                    className="org-logo-hidden-input"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileChange}
                  />
                  <button className="admin-config-btn" type="button" onClick={handleChangeLogo}>
                    Change
                  </button>
                  <button className="admin-config-btn admin-config-btn-danger" type="button" onClick={handleDeleteLogo}>
                    Delete
                  </button>
                </div>
              )}
            </aside>

            <section className="org-details-column">
              <div className="org-profile-grid">
                <div className="org-profile-field org-profile-field-full">
                  <label>Company Name</label>
                  {isEditing ? (
                    <input
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      placeholder="Enter organization name"
                    />
                  ) : (
                    <p className="org-view-value">{form.name || "-"}</p>
                  )}
                </div>

                <div className="org-profile-field org-profile-field-full">
                  <label>Address</label>
                  {isEditing ? (
                    <textarea
                      rows={2}
                      value={form.address}
                      onChange={(e) => updateField("address", e.target.value)}
                      placeholder="Enter address"
                    />
                  ) : (
                    <p className="org-view-value">{form.address || "-"}</p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="org-below-section">
            <div className="org-three-field-row">
              <div className="org-profile-field">
                <label>Area</label>
                {isEditing ? (
                  <input value={form.area} onChange={(e) => updateField("area", e.target.value)} placeholder="Area" />
                ) : (
                  <p className="org-view-value">{form.area || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>City</label>
                {isEditing ? (
                  <input value={form.city} onChange={(e) => updateField("city", e.target.value)} placeholder="City" />
                ) : (
                  <p className="org-view-value">{form.city || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>Pin Code</label>
                {isEditing ? (
                  <div className="org-pincode-wrap">
                    <input
                      value={form.pincode}
                      onChange={(e) => updateField("pincode", e.target.value)}
                      onBlur={lookupPincode}
                      placeholder="Pin code"
                    />
                    {pincodeLoading ? <span className="org-pincode-status">Fetching...</span> : null}
                  </div>
                ) : (
                  <p className="org-view-value">{form.pincode || "-"}</p>
                )}
              </div>
            </div>

            <div className="org-three-field-row">
              <div className="org-profile-field">
                <label>District</label>
                {isEditing ? (
                  <input value={form.district} onChange={(e) => updateField("district", e.target.value)} placeholder="District" />
                ) : (
                  <p className="org-view-value">{form.district || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>State</label>
                {isEditing ? (
                  <input value={form.state} onChange={(e) => updateField("state", e.target.value)} placeholder="State" />
                ) : (
                  <p className="org-view-value">{form.state || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>Country</label>
                {isEditing ? (
                  <input value={form.country} onChange={(e) => updateField("country", e.target.value)} placeholder="Country" />
                ) : (
                  <p className="org-view-value">{form.country || "-"}</p>
                )}
              </div>
            </div>

            <div className="org-three-field-row">
              <div className="org-profile-field">
                <label>CIN Number</label>
                {isEditing ? (
                  <input value={form.cinNumber} onChange={(e) => updateField("cinNumber", e.target.value)} placeholder="CIN number" />
                ) : (
                  <p className="org-view-value">{form.cinNumber || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>PAN Number</label>
                {isEditing ? (
                  <input value={form.panNumber} onChange={(e) => updateField("panNumber", e.target.value)} placeholder="PAN number" />
                ) : (
                  <p className="org-view-value">{form.panNumber || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>GST Number</label>
                {isEditing ? (
                  <input value={form.gstNumber} onChange={(e) => updateField("gstNumber", e.target.value)} placeholder="GST number" />
                ) : (
                  <p className="org-view-value">{form.gstNumber || "-"}</p>
                )}
              </div>
            </div>

            <div className="org-contacts-section">
              <div className="org-contacts-title-row">
                <h4>Contact Details</h4>
                {isEditing ? (
                  <button className="admin-config-btn" onClick={addContact}>
                    + Add Contact
                  </button>
                ) : null}
              </div>

              {(form.contacts || []).map((contact, index) => (
                <div className="org-contact-row" key={contact._localId || index}>
                  {isEditing ? (
                    <>
                      <input
                        placeholder="Name"
                        value={contact.name || ""}
                        onChange={(e) => updateContact(index, "name", e.target.value)}
                      />
                      <input
                        placeholder="Designation"
                        value={contact.designation || ""}
                        onChange={(e) => updateContact(index, "designation", e.target.value)}
                      />
                      <input
                        placeholder="Phone"
                        value={contact.phone || ""}
                        onChange={(e) => updateContact(index, "phone", e.target.value)}
                      />
                      <input
                        placeholder="Email"
                        value={contact.email || ""}
                        onChange={(e) => updateContact(index, "email", e.target.value)}
                      />
                      <button
                        className="admin-config-btn admin-config-btn-danger"
                        onClick={() => removeContact(index)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <div className="org-contact-view">
                      <strong>{contact.name || "-"}</strong>
                      <span>{contact.designation || "-"}</span>
                      <span>{contact.phone || "-"}</span>
                      <span>{contact.email || "-"}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
