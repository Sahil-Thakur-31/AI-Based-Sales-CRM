import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
import "./styles/LeadsDashboard.css";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
  const [expandedClientId, setExpandedClientId] = useState("");
  const [clientDealsById, setClientDealsById] = useState({});
  const [clientDealsLoadingById, setClientDealsLoadingById] = useState({});
  const [clientDealsErrorById, setClientDealsErrorById] = useState({});

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

  useEffect(() => {
    setExpandedClientId("");
  }, [activeTab, currentPage, query, industryFilter, sourceFilter]);

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

  const loadClientDeals = async (clientId) => {
    const id = String(clientId || "");
    if (!id) return;

    try {
      setClientDealsLoadingById((prev) => ({ ...prev, [id]: true }));
      setClientDealsErrorById((prev) => ({ ...prev, [id]: "" }));

      const { data } = await API.get("/deals", { params: { client_id: id } });
      const rows = Array.isArray(data) ? data : [];

      rows.sort(
        (a, b) =>
          new Date(b?.last_contact_date || b?.updatedAt || b?.createdAt || 0) -
          new Date(a?.last_contact_date || a?.updatedAt || a?.createdAt || 0)
      );

      setClientDealsById((prev) => ({ ...prev, [id]: rows }));
    } catch (err) {
      console.error("client deals load error", err);
      setClientDealsById((prev) => ({ ...prev, [id]: [] }));
      setClientDealsErrorById((prev) => ({
        ...prev,
        [id]: err?.response?.data?.message || "Failed to load previous deals",
      }));
    } finally {
      setClientDealsLoadingById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleClientRowToggle = async (clientId) => {
    if (activeTab !== "active") return;
    const id = String(clientId || "");
    if (!id) return;

    if (expandedClientId === id) {
      setExpandedClientId("");
      return;
    }

    setExpandedClientId(id);

    const alreadyLoaded = Object.prototype.hasOwnProperty.call(clientDealsById, id);
    if (!alreadyLoaded && !clientDealsLoadingById[id]) {
      await loadClientDeals(id);
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
              paginatedRows.map((client) => {
                const clientId = String(client?._id || "");
                const expanded = activeTab === "active" && expandedClientId === clientId;
                const deals = clientDealsById[clientId] || [];
                const dealsLoading = Boolean(clientDealsLoadingById[clientId]);
                const dealsError = clientDealsErrorById[clientId] || "";

                return (
                  <Fragment key={clientId}>
                    <tr
                      className={activeTab === "active" ? "client-latest-row client-latest-row-clickable" : ""}
                      onClick={() => handleClientRowToggle(clientId)}
                    >
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
                              <button
                                className="view-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/clients/${clientId}`);
                                }}
                              >
                                View More
                              </button>
                              {isAdminOrManager && (
                                <button
                                  className="soft-delete-btn"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteClient(clientId);
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="convert-btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRestoreClient(clientId);
                              }}
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {expanded ? (
                      <tr className="client-accordion-panel-row">
                        <td colSpan={6}>
                          <div className="client-accordion-panel">
                            {dealsLoading ? (
                              <div className="client-history-empty">Loading deals...</div>
                            ) : dealsError ? (
                              <div className="client-history-empty">{dealsError}</div>
                            ) : deals.length === 0 ? (
                              <div className="client-history-empty">No previous deals found for this client.</div>
                            ) : (
                              deals.map((deal, index) => {
                                const dealId = String(deal?._id || deal?.deal_id || "");
                                const updatedOn =
                                  deal?.last_contact_date || deal?.updatedAt || deal?.createdAt || null;

                                return (
                                  <div key={dealId || `${clientId}-${index}`} className="client-history-card">
                                    <div className="client-history-inline">
                                      <span className="client-history-badge">
                                        {index === 0 ? "Latest" : "Previous"}
                                      </span>
                                      <strong>{deal?.company_name || client.name || "Untitled Deal"}</strong>
                                      <span>Stage: {deal?.stage || "-"}</span>
                                      <span>Value: {formatCurrency(deal?.deal_value_estimate || 0)}</span>
                                      <span>Updated: {formatDate(updatedOn)}</span>
                                    </div>
                                    <div className="client-history-actions">
                                      <button
                                        className="view-btn"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (!dealId) return;
                                          navigate(`/leads/${dealId}?view=deal&dealId=${dealId}`);
                                        }}
                                        disabled={!dealId}
                                      >
                                        View
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
