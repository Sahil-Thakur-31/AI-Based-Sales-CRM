import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Clients.css";

export default function Clients() {
  const navigate = useNavigate();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await API.get("/clients");
      setClients(res.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const lower = query.toLowerCase();
    return clients.filter((client) =>
      (client.name || "").toLowerCase().includes(lower) ||
      (client.industryName || "").toLowerCase().includes(lower) ||
      (client.sourceName || "").toLowerCase().includes(lower)
    );
  }, [clients, query]);

  return (
    <div className="clients-page">
      <div className="clients-header">
        <input
          className="app-search-input clients-search-input"
          placeholder="Search clients..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div>
          <button className="clients-btn clients-btn-primary" onClick={() => navigate('/clients/new')}>
            + Add Client
          </button>
        </div>
      </div>

      <div className="clients-card">
        {loading ? (
          <div className="clients-empty">Loading clients...</div>
        ) : error ? (
          <div className="clients-empty">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="clients-empty">No clients found</div>
        ) : (
          <div className="clients-table-wrap">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Industry</th>
                  <th>Contacts</th>
                  <th>Deals</th>
                  <th>Website</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client) => (
                  <tr key={client._id}>
                    <td>{client.name || "-"}</td>
                    <td>{client.industryName || "-"}</td>
                    <td>{client.contactsCount || 0}</td>
                    <td>{client.deal_count || 0}</td>
                    <td>{client.website || "-"}</td>
                    <td>
                      <button
                        className="clients-view-btn"
                        onClick={() => navigate(`/clients/${client._id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
