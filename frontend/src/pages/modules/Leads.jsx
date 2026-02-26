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
  const [stageFilter, setStageFilter] = useState("All");
  const [industryOptions, setIndustryOptions] = useState([]);

  const [deletedDeals, setDeletedDeals] = useState([]);
  const [loadingDeletedDeals, setLoadingDeletedDeals] = useState(true);
  const [showDeletedDeals, setShowDeletedDeals] = useState(false);

  useEffect(() => {
    setViewMode(defaultView === "deals" ? "deals" : "leads");
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

  const sourceRows = viewMode === "deals" ? deals : leads;
  const loading = viewMode === "deals" ? loadingDeals : loadingLeads;
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

  return (
    <div className="leads-container">
      {viewMode === "leads" && (
        <div className="top-actions">
          <button className="btn" type="button" onClick={() => { }}>
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
        <h2>{viewMode === "deals" ? "All Deals" : "All Leads"} (<span className="lead-count">{filteredRows.length}</span>)</h2>
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
                  <td>
                    <div className="row-actions">
                      <button
                        className="view-btn"
                        onClick={() => {
                          if (viewMode === "deals") {
                            const routeId = row.lead_id || row._id;
                            if (!routeId) return;
                            navigate(`/leads/${routeId}?view=deal&dealId=${row._id}`);
                            return;
                          }
                          const leadId = row._id || row.lead_id;
                          if (!leadId) return;
                          navigate(`/leads/${leadId}`);
                        }}
                      >
                        View More
                      </button>
                      {viewMode === "deals" && (
                        <button
                          className="view-btn quote-btn"
                          disabled={!row._id}
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
      {viewMode === "deals" && (
        <div className="deleted-toggle-wrap">
          <button
            type="button"
            className="deleted-toggle-btn"
            onClick={() => setShowDeletedDeals((prev) => !prev)}
          >
            {showDeletedDeals
              ? "Hide Recently Deleted Deals"
              : "Recently Deleted Deals"}
          </button>
        </div>
      )}
      {viewMode === "leads" && (
        <div className="deleted-toggle-wrap">
          <button type="button" className="deleted-toggle-btn" onClick={() => setShowDeletedLeads((prev) => !prev)}>
            {showDeletedLeads ? "Hide Recently Deleted Leads" : "Recently Deleted Leads"}
          </button>
        </div>
      )}
      {viewMode === "deals" && showDeletedDeals && (
        <>
          <div className="leads-header deleted-header">
            <h2>
              Recently Deleted Deals (
              <span className="lead-count">{deletedDeals.length}</span>)
            </h2>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Industry</th>
                  <th>Value</th>
                  <th>Stage</th>
                  <th>Delete Reason</th>
                  <th>Last Contact</th>
                  <th>Next Action</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {loadingDeletedDeals && (
                  <tr>
                    <td colSpan={8}>Loading deleted deals...</td>
                  </tr>
                )}

                {!loadingDeletedDeals && deletedDeals.length === 0 && (
                  <tr>
                    <td colSpan={8}>No recently deleted deals</td>
                  </tr>
                )}

                {!loadingDeletedDeals &&
                  deletedDeals.map((row) => {
                    const t = getTemperature(row);
                    return (
                      <tr key={row._id}>
                        <td className="company-cell">
                          {row.company_name || "-"}
                        </td>

                        <td>
                          <div className="contact-name">
                            {row.primary_contact?.name || "-"}
                          </div>
                          <small className="contact-subtext">
                            {row.primary_contact?.email ||
                              row.primary_contact?.phone ||
                              "-"}
                          </small>
                        </td>

                        <td>{row.industry || "-"}</td>
                        <td>{formatCurrency(row.deal_value_estimate)}</td>

                        <td>
                          <span className="stage-chip">
                            {row.stage || "-"}
                          </span>
                        </td>

                        <td>
                          <span className="delete-reason">
                            {row.delete_reason || row.deleted_reason || "No reason provided"}
                          </span>
                        </td>

                        <td>{formatDate(row.last_contact_date)}</td>
                        <td>{row.next_action || "-"}</td>

                        <td>
                          <button
                            className="view-btn"
                            onClick={() => {
                              const routeId = row.lead_id || row._id;
                              if (!routeId) return;
                              navigate(
                                `/leads/${routeId}?view=deal&dealId=${row._id}&deleted=true`
                              );
                            }}
                          >
                            View More
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
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
                  <th>Company</th><th>Contact</th><th>Industry</th><th>Value</th><th>Stage</th>
                  <th>Delete Reason</th><th>Last Contact</th><th>Next Action</th><th></th>
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
                      <td>
                        <button
                          className="view-btn"
                          onClick={() => {
                            const leadId = row._id || row.lead_id;
                            if (!leadId) return;
                            navigate(`/leads/${leadId}?deleted=true`);
                          }}
                        >
                          View More
                        </button>
                      </td>
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

