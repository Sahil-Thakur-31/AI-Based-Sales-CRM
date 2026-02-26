import { useEffect, useMemo, useState } from "react";
import API from "../../api";
import "./adminsetting/admin-config.css";

function initialForm() {
  return {
    name: "",
    industry: "",
    source: "",
    Address: "",
    website: "",
    employeeCount: "",
    turnoverRange: "",
    deal_count: "",
    GST_no: ""
  };
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [sources, setSources] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const [clientsRes, industriesRes, sourcesRes] = await Promise.all([
        API.get("/clients"),
        API.get("/industries"),
        API.get("/sources")
      ]);

      setClients(clientsRes.data || []);
      setIndustries(industriesRes.data || []);
      setSources(sourcesRes.data || []);
    } catch (err) {
      console.error(err);
      alert("Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  const openAddForm = () => {
    setEditingId(null);
    setForm(initialForm());
    setFormVisible(true);
  };

  const openEditForm = (item) => {
    setEditingId(item._id);
    setForm({
      name: item.name || "",
      industry: item.industry || "",
      source: item.source || "",
      Address: item.Address || "",
      website: item.website || "",
      employeeCount: item.employeeCount ?? "",
      turnoverRange: item.turnoverRange || "",
      deal_count: item.deal_count ?? "",
      GST_no: item.GST_no || ""
    });
    setFormVisible(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      alert("Client name is required");
      return;
    }

    if (!form.industry) {
      alert("Industry is required");
      return;
    }

    try {
      const payload = {
        ...form,
        employeeCount: form.employeeCount === "" ? 0 : Number(form.employeeCount),
        deal_count: form.deal_count === "" ? 0 : Number(form.deal_count)
      };

      if (editingId) {
        await API.put(`/clients/${editingId}`, payload);
      } else {
        await API.post("/clients", payload);
      }

      setFormVisible(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Save failed");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete client?")) return;

    try {
      await API.put(`/clients/delete/${id}`);
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Delete failed");
    }
  };

  const filteredClients = useMemo(() => {
    if (!filter.trim()) return clients;
    const term = filter.toLowerCase();
    return clients.filter((item) =>
      Object.values(item).some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [clients, filter]);

  return (
    <div className="admin-config-page">
      <div className="admin-config-header">
        <h2>Clients</h2>
        <div className="admin-config-actions">
          <input
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="admin-config-btn" onClick={openAddForm}>
            Add
          </button>
        </div>
      </div>

      <table className="admin-config-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Industry</th>
            <th>Source</th>
            <th>Website</th>
            <th>Employees</th>
            <th>Deals</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="admin-config-empty">
                Loading clients...
              </td>
            </tr>
          ) : filteredClients.length === 0 ? (
            <tr>
              <td colSpan={7} className="admin-config-empty">
                No clients found
              </td>
            </tr>
          ) : (
            filteredClients.map((item) => (
              <tr key={item._id}>
                <td>{item.name}</td>
                <td>{item.industryName || "-"}</td>
                <td>{item.sourceName || "-"}</td>
                <td>{item.website || "-"}</td>
                <td>{item.employeeCount || 0}</td>
                <td>{item.deal_count || 0}</td>
                <td>
                  <button className="admin-config-btn" onClick={() => openEditForm(item)}>
                    Edit
                  </button>
                  <button
                    className="admin-config-btn admin-config-btn-danger"
                    onClick={() => remove(item._id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {formVisible && (
        <div className="admin-config-modal">
          <div className="admin-config-modal-content">
            <h3>{editingId ? "Edit Client" : "Add Client"}</h3>

            <input
              placeholder="Client Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <select
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            >
              <option value="">Select Industry</option>
              {industries.map((industry) => (
                <option key={industry._id} value={industry._id}>
                  {industry.name}
                </option>
              ))}
            </select>

            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="">Select Source (Optional)</option>
              {sources.map((source) => (
                <option key={source._id} value={source._id}>
                  {source.name}
                </option>
              ))}
            </select>

            <input
              placeholder="Address"
              value={form.Address}
              onChange={(e) => setForm({ ...form, Address: e.target.value })}
            />

            <input
              placeholder="Website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />

            <input
              type="number"
              min="0"
              placeholder="Employee Count"
              value={form.employeeCount}
              onChange={(e) => setForm({ ...form, employeeCount: e.target.value })}
            />

            <input
              placeholder="Turnover Range"
              value={form.turnoverRange}
              onChange={(e) => setForm({ ...form, turnoverRange: e.target.value })}
            />

            <input
              type="number"
              min="0"
              placeholder="Deal Count"
              value={form.deal_count}
              onChange={(e) => setForm({ ...form, deal_count: e.target.value })}
            />

            <input
              placeholder="GST No"
              value={form.GST_no}
              onChange={(e) => setForm({ ...form, GST_no: e.target.value })}
            />

            <div className="admin-config-modal-actions">
              <button className="admin-config-btn" onClick={save}>
                Save
              </button>
              <button onClick={() => setFormVisible(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
