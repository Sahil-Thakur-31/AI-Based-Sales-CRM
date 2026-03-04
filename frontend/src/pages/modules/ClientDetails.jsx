import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import "./styles/Clients.css";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export default function ClientDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);

  useEffect(() => {
    loadClient();
  }, [id]);

  const loadClient = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await API.get(`/clients/${id}`);
      setForm(res.data);
    } catch (err) {
      console.error(err);
      setError("Failed to load client details");
    } finally {
      setLoading(false);
    }
  };

  const updateClientField = (field, value) => {
    setForm((prev) => ({
      ...prev,
      client: {
        ...(prev.client || {}),
        [field]: value
      }
    }));
  };

  const updateContactField = (index, field, value) => {
    setForm((prev) => {
      const contacts = [...(prev.contacts || [])];
      contacts[index] = {
        ...contacts[index],
        [field]: value
      };
      return {
        ...prev,
        contacts
      };
    });
  };

  const addContact = () => {
    setForm((prev) => ({
      ...prev,
      contacts: [
        ...(prev.contacts || []),
        {
          name: "",
          designation: "",
          phone: "",
          email: "",
          linkedin: "",
          is_active: true
        }
      ]
    }));
  };

  const saveClient = async () => {
    if (!form) return;

    try {
      setSaving(true);
      setError("");

      const payload = {
        client: {
          name: form.client?.name || "",
          industry: form.client?.industry || "",
          Address: form.client?.Address || "",
          employeeCount: form.client?.employeeCount ?? "",
          turnoverRange: form.client?.turnoverRange || "",
          website: form.client?.website || "",
          source: form.client?.source || "",
          GST_no: form.client?.GST_no || "",
          URD: form.client?.URD || "",
          Aadhar_doc: form.client?.Aadhar_doc || "",
          PanCard_doc: form.client?.PanCard_doc || "",
          Other_docs: form.client?.Other_docs || "",
          location: form.client?.location || ""
        },
        contacts: (form.contacts || []).map((contact) => ({
          _id: contact._id,
          name: contact.name || "",
          designation: contact.designation || "",
          phone: contact.phone || "",
          email: contact.email || "",
          linkedin: contact.linkedin || "",
          is_active: contact.is_active,
          is_primary: contact.is_primary
        }))
      };

      await API.put(`/clients/${id}`, payload);
      navigate("/clients");
    } catch (err) {
      console.error(err);
      setError("Failed to save client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="clients-detail-page">
      <div className="clients-detail-topbar">
        <button className="clients-btn clients-btn-secondary" onClick={() => navigate("/clients")}>
          Back to Clients
        </button>
        <button className="clients-btn clients-btn-primary" onClick={saveClient} disabled={saving || loading}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="clients-detail-card">
        {loading ? (
          <div className="clients-empty">Loading client details...</div>
        ) : error ? (
          <div className="clients-empty">{error}</div>
        ) : !form ? (
          <div className="clients-empty">No client data found.</div>
        ) : (
          <>
            <h3 className="clients-section-title">Client</h3>
            <div className="clients-grid">
              <div className="clients-field">
                <label>Name</label>
                <input value={form.client?.name || ""} onChange={(e) => updateClientField("name", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Website</label>
                <input value={form.client?.website || ""} onChange={(e) => updateClientField("website", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Employee Count</label>
                <input type="number" value={form.client?.employeeCount ?? ""} onChange={(e) => updateClientField("employeeCount", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Turnover Range</label>
                <input value={form.client?.turnoverRange || ""} onChange={(e) => updateClientField("turnoverRange", e.target.value)} />
              </div>
              <div className="clients-field clients-field-full">
                <label>Address</label>
                <input value={form.client?.Address || ""} onChange={(e) => updateClientField("Address", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>GST No</label>
                <input value={form.client?.GST_no || ""} onChange={(e) => updateClientField("GST_no", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>URD</label>
                <input value={form.client?.URD || ""} onChange={(e) => updateClientField("URD", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Industry ID</label>
                <input value={form.client?.industry || ""} onChange={(e) => updateClientField("industry", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Source ID</label>
                <input value={form.client?.source || ""} onChange={(e) => updateClientField("source", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Location ID</label>
                <input value={form.client?.location || ""} onChange={(e) => updateClientField("location", e.target.value)} />
              </div>
              <div className="clients-field">
                <label>Created At</label>
                <input value={formatDate(form.client?.createdAt)} readOnly disabled />
              </div>
            </div>

            <div className="clients-contacts-head">
              <h3 className="clients-section-title">Client Contacts</h3>
              <button className="clients-btn clients-btn-secondary" onClick={addContact}>+ Add Contact</button>
            </div>

            {!form.contacts?.length ? (
              <div className="clients-empty">No contacts available.</div>
            ) : (
              <div className="clients-contacts-wrap">
                {form.contacts.map((contact, index) => (
                  <div className="clients-contact-card" key={contact._id || index}>
                    <div className="clients-grid">
                      <div className="clients-field">
                        <label>Name</label>
                        <input value={contact.name || ""} onChange={(e) => updateContactField(index, "name", e.target.value)} />
                      </div>
                      <div className="clients-field">
                        <label>Designation</label>
                        <input value={contact.designation || ""} onChange={(e) => updateContactField(index, "designation", e.target.value)} />
                      </div>
                      <div className="clients-field">
                        <label>Phone</label>
                        <PhoneInput
                          international
                          defaultCountry="IN"
                          value={contact.phone || ""}
                          onChange={(val) => updateContactField(index, "phone", val)}
                        />
                      </div>
                      <div className="clients-field">
                        <label>Email</label>
                        <input value={contact.email || ""} onChange={(e) => updateContactField(index, "email", e.target.value)} />
                      </div>
                      <div className="clients-field clients-field-full">
                        <label>LinkedIn</label>
                        <input value={contact.linkedin || ""} onChange={(e) => updateContactField(index, "linkedin", e.target.value)} />
                      </div>
                      <div className="clients-field clients-checkbox-field">
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(contact.is_active)}
                            onChange={(e) => updateContactField(index, "is_active", e.target.checked)}
                          />
                          Active Contact
                        </label>
                      </div>
                      <div className="clients-field clients-checkbox-field">
                        <label>
                          <input
                            type="radio"
                            name="primary_contact_client"
                            checked={Boolean(contact.is_primary)}
                            onChange={() => {
                              setForm(prev => {
                                const newContacts = (prev.contacts || []).map((c, i) => ({
                                  ...c,
                                  is_primary: i === index
                                }));
                                return { ...prev, contacts: newContacts };
                              });
                            }}
                          />
                          Primary Contact
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
