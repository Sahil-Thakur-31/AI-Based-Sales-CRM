import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./LeadsDashboard.css";

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

  useEffect(() => {
    setViewMode(defaultView === "deals" ? "deals" : "leads");
  }, [defaultView]);

  useEffect(() => {
    const load = async () => {
      const [leadsRes, dealsRes, deletedRes] = await Promise.allSettled([
        API.get("/leads"),
        API.get("/deals"),
        API.get("/leads", { params: { deleted_only: true, limit: 10 } }),
      ]);

      if (leadsRes.status === "fulfilled") setLeads(Array.isArray(leadsRes.value.data) ? leadsRes.value.data : []);
      if (dealsRes.status === "fulfilled") setDeals(Array.isArray(dealsRes.value.data) ? dealsRes.value.data : []);
      if (deletedRes.status === "fulfilled") setDeletedLeads(Array.isArray(deletedRes.value.data) ? deletedRes.value.data : []);

      setLoadingLeads(false);
      setLoadingDeals(false);
      setLoadingDeleted(false);
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

  const sourceRows = viewMode === "deals" ? deals : leads;
  const loading = viewMode === "deals" ? loadingDeals : loadingLeads;
  const industries = useMemo(
    () => ["All", ...new Set(sourceRows.map((r) => r.industry).filter(Boolean))],
    [sourceRows]
  );

  const filteredRows = useMemo(() => {
    return sourceRows.filter((row) => {
      const q = search.trim().toLowerCase();
      const company = (row.company_name || "").toLowerCase();
      const contact = (row.primary_contact?.name || "").toLowerCase();
      const matchesSearch = !q || company.includes(q) || contact.includes(q);
      const matchesIndustry = industryFilter === "All" || row.industry === industryFilter;
      const matchesTemp = temperatureFilter === "All" || getTemperature(row) === temperatureFilter;
      return matchesSearch && matchesIndustry && matchesTemp;
    });
  }, [sourceRows, search, industryFilter, temperatureFilter]);

  return (
    <div className="leads-container">
      {viewMode === "leads" && (
        <div className="top-actions">
          <button className="btn" type="button" onClick={() => {}}>
            <span className="action-icon">📇</span>
            Scan Business Card
            <span className="ocr-tag">OCR</span>
          </button>
          <button className="btn" type="button" onClick={() => navigate("/leads/new")}>
            <span className="action-icon">➕</span>
            Add Lead Manually
          </button>
          <button className={`btn ${temperatureFilter === "hot" ? "active" : ""}`} type="button" onClick={() => setTemperatureFilter((p) => (p === "hot" ? "All" : "hot"))}>
            <span className="action-icon">🔥</span>
            Hot Leads
          </button>
          <button className={`btn ${temperatureFilter === "warm" ? "active" : ""}`} type="button" onClick={() => setTemperatureFilter((p) => (p === "warm" ? "All" : "warm"))}>
            <span className="action-icon">🌡️</span>
            Warm Leads
          </button>
          <button className={`btn ${temperatureFilter === "cold" ? "active" : ""}`} type="button" onClick={() => setTemperatureFilter((p) => (p === "cold" ? "All" : "cold"))}>
            <span className="action-icon">❄️</span>
            Cold Leads
          </button>
          <button className="btn" type="button" onClick={() => navigate("")}>
            <span className="action-icon">📥</span>
            Import CSV
          </button>
        </div>
      )}

      <div className="leads-header">
        <h2>{viewMode === "deals" ? "All Deals" : "All Leads"} (<span className="lead-count">{filteredRows.length}</span>)</h2>
        <div className="filters">
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            <option value="All">All Industries</option>
            <option value="Solar">Solar</option>
            <option value="Manufacturing">Manufacturing</option>
          </select>
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
              <th>AI Score</th>
              <th>Last Contact</th>
              <th>Next Action</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8}>{viewMode === "deals" ? "Loading deals..." : "Loading leads..."}</td></tr>}
            {!loading && filteredRows.length === 0 && <tr><td colSpan={8}>{viewMode === "deals" ? "No deals found" : "No leads found"}</td></tr>}
            {!loading && filteredRows.map((row) => {
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
                  <td><span className={`ai-chip ${t}`}>{`${row.ai_score ?? "-"} - ${getTemperatureLabel(t)}`}</span></td>
                  <td>{formatDate(row.last_contact_date)}</td>
                  <td>{row.next_action || "-"}</td>
                  <td>
                    <button className="view-btn" onClick={() => viewMode === "deals" ? navigate(`/leads/${row.lead_id || row._id}?view=deal&dealId=${row._id}`) : navigate(`/leads/${row._id}`)}>
                      View More
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewMode === "leads" && (
        <div className="deleted-toggle-wrap">
          <button type="button" className="deleted-toggle-btn" onClick={() => setShowDeletedLeads((prev) => !prev)}>
            {showDeletedLeads ? "Hide Recently Deleted Leads" : "Recently Deleted Leads"}
          </button>
        </div>
      )}

      {viewMode === "leads" && showDeletedLeads && (
        <>
          <div className="leads-header deleted-header">
            <h2>Recently Deleted Leads (<span className="lead-count">{deletedLeads.length}</span>)</h2>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company</th><th>Contact</th><th>Industry</th><th>Value</th><th>AI Score</th><th>Last Contact</th><th>Next Action</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loadingDeleted && <tr><td colSpan={8}>Loading deleted leads...</td></tr>}
                {!loadingDeleted && deletedLeads.length === 0 && <tr><td colSpan={8}>No recently deleted leads</td></tr>}
                {!loadingDeleted && deletedLeads.map((row) => {
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
                      <td><span className={`ai-chip ${t}`}>{`${row.ai_score ?? "-"} - ${getTemperatureLabel(t)}`}</span></td>
                      <td>{formatDate(row.last_contact_date)}</td>
                      <td>{row.next_action || "-"}</td>
                      <td><button className="view-btn" onClick={() => navigate(`/leads/${row._id}?deleted=true`)}>View More</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default LeadsDashboard;
