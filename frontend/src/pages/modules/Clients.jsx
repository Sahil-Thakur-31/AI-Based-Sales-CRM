import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
import "./styles/LeadsDashboard.css";

export default function Clients() {
  const navigate = useNavigate();
  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdminOrManager = roleName === "admin" || roleName === "manager";

  const [clients, setClients] = useState([]);
  const [deletedClients, setDeletedClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [activeTab, setActiveTab] = useState("active");
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 6;

  const loadClients = async () => {
    try {
      setLoading(true);
      const [activeRes, deletedRes] = await Promise.allSettled([
        API.get("/clients"),
        API.get("/clients", { params: { deleted_only: true } })
      ]);

      if (activeRes.status === "fulfilled") {
        setClients(Array.isArray(activeRes.value.data) ? activeRes.value.data : []);
      } else {
        setClients([]);
      }

      if (deletedRes.status === "fulfilled") {
        setDeletedClients(Array.isArray(deletedRes.value.data) ? deletedRes.value.data : []);
      } else {
        setDeletedClients([]);
      }
    } catch (err) {
      console.error(err);
      setClients([]);
      setDeletedClients([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  const sourceRows = useMemo(
    () => (activeTab === "deleted" ? deletedClients : clients),
    [activeTab, clients, deletedClients]
  );

  const industryOptions = useMemo(
    () => ["All", ...new Set([...clients, ...deletedClients].map((row) => row.industryName).filter(Boolean))],
    [clients, deletedClients]
  );

  const sourceOptions = useMemo(
    () => ["All", ...new Set([...clients, ...deletedClients].map((row) => row.sourceName).filter(Boolean))],
    [clients, deletedClients]
  );

  const filteredRows = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return sourceRows.filter((row) => {
      const matchesSearch =
        !lower ||
        String(row.name || "").toLowerCase().includes(lower) ||
        String(row.industryName || "").toLowerCase().includes(lower) ||
        String(row.sourceName || "").toLowerCase().includes(lower) ||
        String(row.primaryContact?.name || "").toLowerCase().includes(lower) ||
        String(row.primaryContact?.email || "").toLowerCase().includes(lower);

      const matchesIndustry = industryFilter === "All" || row.industryName === industryFilter;
      const matchesSource = sourceFilter === "All" || row.sourceName === sourceFilter;
      return matchesSearch && matchesIndustry && matchesSource;
    });
  }, [sourceRows, query, industryFilter, sourceFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, industryFilter, sourceFilter, activeTab, filteredRows.length]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
  const paginatedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const tabCounts = {
    active: clients.length,
    deleted: deletedClients.length
  };

  const handleDeleteClient = async (id) => {
    if (!window.confirm("Delete this client?")) return;
    try {
      await API.put(`/clients/delete/${id}`);
      await loadClients();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to delete client");
    }
  };

  const handleRestoreClient = async (id) => {
    try {
      await API.put(`/clients/activate/${id}`);
      await loadClients();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to restore client");
    }
  };

  return (
    <div className="leads-container">
      <div className="leads-header">
        <div className="status-tabs">
          <button
            className={`tab-btn ${activeTab === "active" ? "active" : ""}`}
            onClick={() => setActiveTab("active")}
          >
            Active ({tabCounts.active})
          </button>
          {isAdminOrManager && (
            <button
              className={`tab-btn ${activeTab === "deleted" ? "active" : ""}`}
              onClick={() => setActiveTab("deleted")}
            >
              Deleted ({tabCounts.deleted})
            </button>
          )}
        </div>

        <div className="filters">
          <input
            type="text"
            placeholder="Search clients..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
            {industryOptions.map((item) => (
              <option key={item} value={item}>
                {item === "All" ? "All Industries" : item}
              </option>
            ))}
          </select>

          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            {sourceOptions.map((item) => (
              <option key={item} value={item}>
                {item === "All" ? "All Sources" : item}
              </option>
            ))}
          </select>

          <button
            className="btn add-deal-btn"
            type="button"
            onClick={() => navigate("/clients/new")}
            style={{ marginLeft: "10px" }}
          >
            <span className="action-icon" style={{ marginRight: "4px" }}>➕</span>
            Add Client
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Industry</th>
              <th>Source</th>
              <th>Contact</th>
              <th>Deals</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>Loading clients...</td>
              </tr>
            )}

            {!loading && paginatedRows.length === 0 && (
              <tr>
                <td colSpan={6}>No clients found</td>
              </tr>
            )}

            {!loading &&
              paginatedRows.map((client) => (
                <tr key={client._id}>
                  <td className="company-cell">{client.name || "-"}</td>
                  <td>{client.industryName || "-"}</td>
                  <td>{client.sourceName || "-"}</td>
                  <td>
                    <div className="deal-contact-cell">
                      <span className="contact-name">{client.primaryContact?.name || "-"}</span>
                      <span className="contact-subtext">{client.primaryContact?.email || "-"}</span>
                    </div>
                  </td>
                  <td>{client.deal_count || 0}</td>
                  <td>
                    <div className="row-actions">
                      {activeTab === "active" ? (
                        <>
                          <button className="view-btn" onClick={() => navigate(`/clients/${client._id}`)}>
                            View More
                          </button>
                          {isAdminOrManager && (
                            <button
                              className="soft-delete-btn"
                              type="button"
                              onClick={() => handleDeleteClient(client._id)}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="convert-btn"
                          type="button"
                          onClick={() => handleRestoreClient(client._id)}
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          handlePageChange={setCurrentPage}
        />
      )}
    </div>
  );
}
