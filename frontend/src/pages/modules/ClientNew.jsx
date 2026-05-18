import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Clients.css";

function initialForm() {
  return {
    name: "",
    industry: "",
    source: "",
    referred_by_user: "",
    expo_event_id: "",
    Address: "",
    website: "",
    employeeCount: "",
    turnoverRange: "",
    deal_count: "",
    GST_no: ""
  };
}

export default function ClientNew() {
  const navigate = useNavigate();
  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const canModifyClient = roleName === "admin" || roleName === "manager";
  const [form, setForm] = useState(initialForm());
  const [industries, setIndustries] = useState([]);
  const [sources, setSources] = useState([]);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canModifyClient) {
      navigate("/clients", { replace: true });
      return;
    }

    (async () => {
      try {
        const [indRes, srcRes, usersRes, eventsRes] = await Promise.all([
          API.get("/industries"),
          API.get("/sources"),
          API.get("/users"),
          API.get("/events")
        ]);
        setIndustries(indRes.data || []);
        setSources(srcRes.data || []);
        setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
        setEvents(Array.isArray(eventsRes.data) ? eventsRes.data : []);
      } catch (err) {
        console.error(err);
      }
    })();
  }, [canModifyClient, navigate]);

  const selectedSource = sources.find((s) => String(s?._id) === String(form.source || ""));
  const normalizedSourceName = String(selectedSource?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const isReferenceLikeSource = /(ref|refer|reference|referr|reffe|refee)/.test(normalizedSourceName);
  const isEventExpoLikeSource =
    (normalizedSourceName.includes("event") && normalizedSourceName.includes("expo")) ||
    normalizedSourceName.includes("events n expos");

  const save = async () => {
    if (!form.name.trim()) return alert("Client name is required");
    if (!form.industry) return alert("Industry is required");
    if (isReferenceLikeSource && !form.referred_by_user) return alert("Please select reference user");
    if (isEventExpoLikeSource && !form.expo_event_id) return alert("Please select event/expo");

    try {
      setSaving(true);
      const payload = {
        name: form.name,
        industry: form.industry,
        source: form.source,
        referred_by_user: form.referred_by_user || null,
        expo_event_id: form.expo_event_id || null,
        Address: form.Address,
        website: form.website,
        employeeCount: form.employeeCount === "" ? 0 : Number(form.employeeCount),
        turnoverRange: form.turnoverRange,
        deal_count: form.deal_count === "" ? 0 : Number(form.deal_count),
        GST_no: form.GST_no
      };

      await API.post("/clients", payload);
      navigate("/clients");
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to create client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="clients-page">
      <div className="clients-header">
        <h2>New Client</h2>
      </div>

      <div className="clients-card">
        <div className="clients-detail-card">
          {error ? <div className="clients-empty">{error}</div> : null}

          <div className="clients-grid">
            <div className="clients-field">
              <label>Client Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="clients-field">
              <label>Website</label>
              <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>

            <div className="clients-field">
              <label>Industry</label>
              <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                <option value="">Select Industry</option>
                {industries.map((ind) => (
                  <option key={ind._id} value={ind._id}>{ind.name}</option>
                ))}
              </select>
            </div>

            <div className="clients-field">
              <label>Source</label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="">Select Source (Optional)</option>
                {sources.map((s) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            </div>

            {isReferenceLikeSource && (
              <div className="clients-field">
                <label>Reference User</label>
                <select
                  value={form.referred_by_user || ""}
                  onChange={(e) => setForm({ ...form, referred_by_user: e.target.value })}
                >
                  <option value="">Select User</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}

            {isEventExpoLikeSource && (
              <div className="clients-field">
                <label>Event / Expo</label>
                <select
                  value={form.expo_event_id || ""}
                  onChange={(e) => setForm({ ...form, expo_event_id: e.target.value })}
                >
                  <option value="">Select Event / Expo</option>
                  {events.map((ev) => (
                    <option key={ev._id} value={ev._id}>{ev.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="clients-field">
              <label>Employee Count</label>
              <input type="number" min="0" value={form.employeeCount} onChange={(e) => setForm({ ...form, employeeCount: e.target.value })} />
            </div>

            <div className="clients-field">
              <label>Turnover Range</label>
              <input value={form.turnoverRange} onChange={(e) => setForm({ ...form, turnoverRange: e.target.value })} />
            </div>

            <div className="clients-field clients-field-full">
              <label>Address</label>
              <input value={form.Address} onChange={(e) => setForm({ ...form, Address: e.target.value })} />
            </div>

            <div className="clients-field">
              <label>Deal Count</label>
              <input type="number" min="0" value={form.deal_count} onChange={(e) => setForm({ ...form, deal_count: e.target.value })} />
            </div>

            <div className="clients-field">
              <label>GST No</label>
              <input value={form.GST_no} onChange={(e) => setForm({ ...form, GST_no: e.target.value })} />
            </div>
          </div>

          <div style={{ padding: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="clients-btn clients-btn-secondary" onClick={() => navigate('/clients')}>Cancel</button>
            <button className="clients-btn clients-btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating...' : 'Create Client'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
