import { useEffect, useState } from "react";
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
    panNumber: "",
    cinNumber: "",
    gstNumber: "",
    contacts: [createEmptyContact()]
  };
}

export default function Organization() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [metrics, setMetrics] = useState({
    employeesCount: 0,
    clientsCount: 0,
    dealsCount: 0
  });
  const [form, setForm] = useState(createEmptyForm());
  const [snapshot, setSnapshot] = useState(createEmptyForm());
  const [logoFile, setLogoFile] = useState(null);
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

      if (profile) {
        const mappedProfile = {
          name: profile.name || "",
          logoUrl: profile.logoUrl || "",
          address: profile.address || "",
          panNumber: profile.panNumber || "",
          cinNumber: profile.cinNumber || "",
          gstNumber: profile.gstNumber || "",
          contacts:
            Array.isArray(profile.contacts) && profile.contacts.length
              ? profile.contacts.map((contact) => ({
                  _localId: contact._id || `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: contact.name || "",
                  designation: contact.designation || "",
                  phone: contact.phone || "",
                  email: contact.email || "",
                  is_active: contact.is_active !== false
                }))
              : [createEmptyContact()]
        };
        setForm(mappedProfile);
        setSnapshot(mappedProfile);
        setLogoPreview(withCacheBust(resolveLogoUrl(profile.logoUrl || "")));
        setLogoFile(null);
      } else {
        const empty = createEmptyForm();
        setForm(empty);
        setSnapshot(empty);
        setLogoPreview("");
        setLogoFile(null);
      }
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
  };

  const cancelEdit = () => {
    setForm(snapshot);
    setLogoPreview(withCacheBust(resolveLogoUrl(snapshot.logoUrl || "")));
    setLogoFile(null);
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
      next[index] = {
        ...next[index],
        [field]: value
      };
      return {
        ...prev,
        contacts: next
      };
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
      payload.append("address", form.address || "");
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

      if (logoFile) {
        payload.append("logo", logoFile);
      }

      const res = await API.put("/organizations/profile", payload);
      const org = res.data?.organization || null;
      const stats = res.data?.stats || {};
      setMetrics({
        employeesCount: Number(stats.employeesCount || metrics.employeesCount),
        clientsCount: Number(stats.clientsCount || metrics.clientsCount),
        dealsCount: Number(stats.dealsCount || metrics.dealsCount)
      });
      if (org) {
        const savedProfile = {
          ...form,
          logoUrl: org.logoUrl || form.logoUrl
        };
        setForm(savedProfile);
        setSnapshot(savedProfile);
        setLogoPreview(withCacheBust(resolveLogoUrl(savedProfile.logoUrl || "")));
        setLogoFile(null);
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
            <div className="org-profile-grid">
              <div className="org-profile-field org-profile-field-full">
                <label>Organization Logo</label>
                <div className="org-logo-block">
                  {isEditing && (
                    <input
                      id="organization-logo-input"
                      className="org-logo-hidden-input"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setLogoFile(file);
                        if (file) {
                          const previewUrl = URL.createObjectURL(file);
                          setLogoPreview(previewUrl);
                        }
                      }}
                    />
                  )}

                  <label
                    htmlFor={isEditing ? "organization-logo-input" : undefined}
                    className={`org-logo-clickable ${isEditing ? "editable" : ""}`}
                  >
                    {logoPreview ? (
                      <img className="org-logo-preview org-logo-preview-large" src={logoPreview} alt="Organization logo" />
                    ) : (
                      <div className="org-logo-preview-empty org-logo-preview-empty-large">No logo uploaded</div>
                    )}
                  </label>
                </div>
              </div>

              <div className="org-profile-field">
                <label>CIN Number</label>
                {isEditing ? (
                  <input
                    value={form.cinNumber}
                    onChange={(e) => updateField("cinNumber", e.target.value)}
                    placeholder="21 character CIN number"
                  />
                ) : (
                  <p className="org-view-value">{form.cinNumber || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>Organization Name</label>
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
                    placeholder="Enter organization address"
                  />
                ) : (
                  <p className="org-view-value">{form.address || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>PAN Number</label>
                {isEditing ? (
                  <input
                    value={form.panNumber}
                    onChange={(e) => updateField("panNumber", e.target.value)}
                    placeholder="ABCDE1234F"
                  />
                ) : (
                  <p className="org-view-value">{form.panNumber || "-"}</p>
                )}
              </div>

              <div className="org-profile-field">
                <label>GST Number</label>
                {isEditing ? (
                  <input
                    value={form.gstNumber}
                    onChange={(e) => updateField("gstNumber", e.target.value)}
                    placeholder="15 character GST number"
                  />
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
          </>
        )}
      </div>
    </div>
  );
}
