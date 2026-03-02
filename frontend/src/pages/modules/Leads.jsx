import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
import "./styles/LeadsDashboard.css";
import "./styles/Expense.css";

function LeadsDashboard({ defaultView = "leads" }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState(defaultView === "deals" ? "deals" : "leads");
  const [leads, setLeads] = useState([]);
  const [deals, setDeals] = useState([]);
  const [deletedLeads, setDeletedLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingDeleted, setLoadingDeleted] = useState(true);
  const [showDeletedLeads, setShowDeletedLeads] = useState(false);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [temperatureFilter, setTemperatureFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState("All");
  const [industryOptions, setIndustryOptions] = useState([]);

  const [deletedDeals, setDeletedDeals] = useState([]);
  const [loadingDeletedDeals, setLoadingDeletedDeals] = useState(true);
  const [showOcrModal, setShowOcrModal] = useState(false);

  // Tabs: "active", "inactive", "deleted"
  const [activeTab, setActiveTab] = useState("active");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    setViewMode(defaultView === "deals" ? "deals" : "leads");
    setActiveTab("active");
    setCurrentPage(1);
  }, [defaultView]);

  useEffect(() => {
    const load = async () => {
      const [
        leadsRes,
        dealsRes,
        deletedRes,
        deletedDealsRes,
        industriesRes,
      ] = await Promise.allSettled([
        API.get("/leads"),
        API.get("/deals"),
        API.get("/leads", { params: { deleted_only: true, limit: 10 } }),
        API.get("/deals", { params: { deleted_only: true, limit: 10 } }),
        API.get("/industries"),
      ]);

      if (leadsRes.status === "fulfilled")
        setLeads(Array.isArray(leadsRes.value.data) ? leadsRes.value.data : []);

      if (dealsRes.status === "fulfilled")
        setDeals(Array.isArray(dealsRes.value.data) ? dealsRes.value.data : []);

      if (deletedRes.status === "fulfilled")
        setDeletedLeads(Array.isArray(deletedRes.value.data) ? deletedRes.value.data : []);

      if (deletedDealsRes.status === "fulfilled")
        setDeletedDeals(
          Array.isArray(deletedDealsRes.value.data)
            ? deletedDealsRes.value.data.filter(d => d.deleted === true || d.is_deleted === true)
            : []
        );

      if (industriesRes.status === "fulfilled") {
        setIndustryOptions(
          (Array.isArray(industriesRes.value.data) ? industriesRes.value.data : [])
            .map((item) => item?.name)
            .filter(Boolean)
        );
      }

      setLoadingLeads(false);
      setLoadingDeals(false);
      setLoadingDeleted(false);
      setLoadingDeletedDeals(false);
    };

    load();
  }, []);

  const getTemperature = (row) => {
    const raw = (row.lead_temperature || row.temperature || "").toLowerCase();
    if (["hot", "warm", "cold"].includes(raw)) return raw;
    const score = Number(row.ai_score);
    if (Number.isNaN(score)) return "";
    if (score >= 80) return "hot";
    if (score >= 50) return "warm";
    return "cold";
  };

  const getTemperatureLabel = (value) => {
    if (value === "hot") return "Hot";
    if (value === "warm") return "Warm";
    if (value === "cold") return "Cold";
    return "-";
  };

  const formatCurrency = (value) => {
    const amount = Number(value);
    if (Number.isNaN(amount)) return "-";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const loading = viewMode === "deals" ? loadingDeals : loadingLeads;

  const tabCounts = useMemo(() => {
    let active = 0, inactive = 0, deleted = 0;
    if (viewMode === "deals") {
      active = deals.filter(d => d.isActive !== false).length;
      inactive = deals.filter(d => d.isActive === false).length;
      deleted = deletedDeals.length;
    } else {
      active = leads.filter(l => l.is_active !== false).length;
      inactive = leads.filter(l => l.is_active === false).length;
      deleted = deletedLeads.length;
    }
    return { active, inactive, deleted };
  }, [viewMode, deals, leads, deletedDeals, deletedLeads]);

  // Decide which source array to use based on viewMode AND activeTab
  const sourceRows = useMemo(() => {
    if (viewMode === "deals") {
      if (activeTab === "deleted") return deletedDeals;
      return deals.filter(d => activeTab === "active" ? (d.isActive !== false) : (d.isActive === false));
    } else {
      if (activeTab === "deleted") return deletedLeads;
      return leads.filter(l => activeTab === "active" ? (l.is_active !== false) : (l.is_active === false));
    }
  }, [viewMode, activeTab, deals, deletedDeals, leads, deletedLeads]);
  const industries = useMemo(() => {
    const fromRows = sourceRows.map((r) => r.industry).filter(Boolean);
    const base = industryOptions.length ? industryOptions : fromRows;
    return ["All", ...new Set(base)];
  }, [sourceRows, industryOptions]);

  const filteredRows = useMemo(() => {
    return sourceRows.filter((row) => {
      const q = search.trim().toLowerCase();
      const company = (row.company_name || "").toLowerCase();
      const contact = (row.primary_contact?.name || "").toLowerCase();
      const industry = (row.industry || "").toLowerCase();
      const valueText = String(row.deal_value_estimate ?? "").toLowerCase();
      const formattedValue = formatCurrency(row.deal_value_estimate).toLowerCase();
      const aiScore = String(row.ai_score ?? "").toLowerCase();
      const aiLabel = getTemperatureLabel(getTemperature(row)).toLowerCase();
      const lastContactText = String(row.last_contact_date || "").toLowerCase();
      const formattedLastContact = formatDate(row.last_contact_date).toLowerCase();
      const nextAction = (row.next_action || "").toLowerCase();

      const matchesSearch =
        !q ||
        company.includes(q) ||
        contact.includes(q) ||
        industry.includes(q) ||
        valueText.includes(q) ||
        formattedValue.includes(q) ||
        aiScore.includes(q) ||
        aiLabel.includes(q) ||
        lastContactText.includes(q) ||
        formattedLastContact.includes(q) ||
        nextAction.includes(q);
      const matchesIndustry = industryFilter === "All" || row.industry === industryFilter;
      const matchesTemp = temperatureFilter === "All" || getTemperature(row) === temperatureFilter;
      const matchesStage = stageFilter === "All" || row.stage === stageFilter;
      return matchesSearch && matchesIndustry && (viewMode === "deals" ? matchesStage : matchesTemp);
    });
  }, [sourceRows, search, industryFilter, temperatureFilter, stageFilter, viewMode]);

  // Reset pagination when data or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredRows.length, activeTab, viewMode]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredRows.length / itemsPerPage);
  const paginatedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdminOrManager = roleName === "admin" || roleName === "manager";

  return (
    <div className="leads-container">
      {viewMode === "leads" && (
        <div className="top-actions">
          <button className="btn" type="button" onClick={() => setShowOcrModal(true)}>
            <span className="action-icon">📇</span>
            Scan Business Card
            <span className="ocr-tag">OCR</span>
          </button>
          <button className="btn" type="button" onClick={() => navigate("/leads/new")}>
            <span className="action-icon">➕</span>
            Add Lead Manually
          </button>
          <button className="btn" type="button" onClick={() => navigate("")}>
            <span className="action-icon">📥</span>
            Import CSV
          </button>
        </div>
      )}

      <div className="leads-header">
        <div className="status-tabs">
          <button
            className={`tab-btn ${activeTab === "active" ? "active" : ""}`}
            onClick={() => setActiveTab("active")}
          >
            Active ({tabCounts.active})
          </button>
          <button
            className={`tab-btn ${activeTab === "inactive" ? "active" : ""}`}
            onClick={() => setActiveTab("inactive")}
          >
            Inactive ({tabCounts.inactive})
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
            placeholder={viewMode === "deals" ? "Search deals..." : "Search leads..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />


          {viewMode === "deals" ? (
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="All">All Stages</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
              <option value="P4">P4</option>
              <option value="P5">P5</option>
              <option value="P6">P6</option>
              <option value="P7">P7</option>
            </select>
          ) : (
            <select
              value={temperatureFilter}
              onChange={(e) => setTemperatureFilter(e.target.value)}
            >
              <option value="All">All Temperatures</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          )}

          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            {industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry === "All" ? "All Industries" : industry}
              </option>
            ))}
          </select>

          {viewMode === "deals" && (
            <button
              className="btn add-deal-btn"
              type="button"
              onClick={() => navigate("/leads/new?view=deal")}
            >
              + Add Deal
            </button>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Contact</th>
              <th>Industry</th>
              <th>Value</th>
              {viewMode === "leads" && <th>AI Score</th>}
              {viewMode === "deals" && <th>Stage</th>}
              <th>Last Contact</th>
              <th>Next Action</th>
              {activeTab === "deleted" && <th>Delete Reason</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9}>{viewMode === "deals" ? "Loading deals..." : "Loading leads..."}</td></tr>}
            {!loading && paginatedRows.length === 0 && <tr><td colSpan={9}>{viewMode === "deals" ? "No deals found" : "No leads found"}</td></tr>}
            {!loading && paginatedRows.map((row) => {
              const t = getTemperature(row);
              return (
                <tr key={row._id}>
                  <td className="company-cell">{row.company_name || "-"}</td>
                  <td>
                    <div className="contact-name">{row.primary_contact?.name || "-"}</div>
                    <small className="contact-subtext">{row.primary_contact?.email || row.primary_contact?.phone || "-"}</small>
                  </td>
                  <td>{row.industry || "-"}</td>
                  <td>{formatCurrency(row.deal_value_estimate)}</td>
                  {viewMode === "leads" && (
                    <td>
                      <span className={`ai-chip ${t}`}>
                        {`${row.ai_score ?? "-"} - ${getTemperatureLabel(t)}`}
                      </span>
                    </td>
                  )}

                  {viewMode === "deals" && (
                    <td>
                      <span className="stage-chip">
                        {row.stage || "-"}
                      </span>
                    </td>
                  )}
                  <td>{formatDate(row.last_contact_date)}</td>
                  <td>{row.next_action || "-"}</td>
                  {activeTab === "deleted" && (
                    <td>
                      <span className="delete-reason">
                        {row.delete_reason || row.deleted_reason || "No reason provided"}
                      </span>
                    </td>
                  )}
                  <td>
                    <div className="row-actions">
                      <button
                        className="view-btn"
                        onClick={() => {
                          if (viewMode === "deals") {
                            const routeId = row.lead_id || row._id;
                            if (!routeId) return;
                            navigate(`/leads/${routeId}?view=deal&dealId=${row._id}${activeTab === 'deleted' ? '&deleted=true' : ''}`);
                            return;
                          }
                          const leadId = row._id || row.lead_id;
                          if (!leadId) return;
                          navigate(`/leads/${leadId}${activeTab === 'deleted' ? '?deleted=true' : ''}`);
                        }}
                      >
                        View More
                      </button>

                      {activeTab === "inactive" && (
                        <button
                          className="view-btn quote-btn"
                          style={{ backgroundColor: '#28a745' }}
                          onClick={async () => {
                            try {
                              const endpoint = viewMode === "deals" ? `/deals/${row._id}` : `/leads/${row._id}`;
                              await API.put(endpoint, { isActive: true, is_active: true });
                              // Reload data or locally adjust list
                              window.location.reload(); // Simple state sync since this handles both deals and leads easily
                            } catch (err) {
                              console.error("Failed to reactivate:", err);
                              alert("Failed to reactivate record.");
                            }
                          }}
                        >
                          Activate
                        </button>
                      )}

                      {viewMode === "deals" && activeTab === "active" && (
                        <button
                          className="view-btn quote-btn"
                          disabled={!row._id || row.isActive === false}
                          onClick={() => {
                            if (!row._id) return;
                            navigate(`/quotations/new?dealId=${row._id}`);
                          }}
                        >
                          Create Quote
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {
        !loading && totalPages > 1 && (
          <div className="pagination-container">
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div className="pagination-numbers">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                .map((page, index, array) => (
                  <React.Fragment key={page}>
                    {index > 0 && page - array[index - 1] > 1 && (
                      <span className="pagination-ellipses">...</span>
                    )}
                    <button
                      className={`pagination-number ${currentPage === page ? "active" : ""}`}
                      onClick={() => handlePageChange(page)}
                    >
                      {page}
                    </button>
                  </React.Fragment>
                ))}
            </div>
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        )
      }

      {
        showOcrModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-large-modal">
              <div className="expense-modal-header">
                <h3>OCR Business Card Scanner</h3>
                <span className="expense-close-btn" onClick={() => setShowOcrModal(false)}>
                  x
                </span>
              </div>

              <div className="expense-upload-box">
                <input
  type="file"
  accept="image/*"
  onChange={async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("card", file);

    try {
      const res = await API.post("/ocr/scan-business-card", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      alert("Lead created successfully!");
      setShowOcrModal(false);
      window.location.reload();

    } catch (err) {
      console.error(err);
      alert("OCR failed");
    }
  }}
/>
                <p>Drop file or click to upload</p>
                <span>Supports: JPG, PNG, PDF</span>

                <div className="expense-ai-section">
                  <button className="expense-ai-btn">+ AI OCR Processing</button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      }
    </div >
  );
}

export default LeadsDashboard;

