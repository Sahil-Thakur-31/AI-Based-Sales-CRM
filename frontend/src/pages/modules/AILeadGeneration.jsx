import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import "./styles/AILeadGeneration.css";

function normalizeText(value) {
  return String(value || "").trim();
}

function compareText(left, right) {
  return normalizeText(left).localeCompare(normalizeText(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export default function AILeadGeneration() {
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    imported: 0,
    industries: 0,
    todayFetchedCount: 0,
    lastRunAt: null,
    lastRunStatus: "",
    lastImportedCount: 0,
    lastUpdatedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importingId, setImportingId] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("All Industries");
  const [sortBy, setSortBy] = useState("company-asc");

  const loadAiLeads = async () => {
    try {
      setLoading(true);
      setError("");
      const { data } = await API.get("/ai-leads");
      setLeads(Array.isArray(data?.items) ? data.items : []);
      setSummary((prev) => ({
        ...prev,
        ...(data?.summary || {}),
      }));
    } catch (err) {
      setLeads([]);
      setError(err?.response?.data?.message || "Failed to load fetched leads.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAiLeads();
  }, []);

  const handleImport = async (leadId) => {
    if (!leadId || importingId || bulkImporting) return false;

    try {
      setImportingId(leadId);
      setError("");
      await API.post(`/ai-leads/${leadId}/import`);
      setLeads((prev) => prev.filter((lead) => String(lead._id) !== leadId));
      setSelectedLeadIds((prev) => prev.filter((id) => id !== leadId));
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to import lead.");
      return false;
    } finally {
      setImportingId("");
    }
  };

  const remainingLeads = useMemo(
    () => leads.filter((lead) => String(lead.status || "").toLowerCase() !== "imported"),
    [leads]
  );

  const industryOptions = useMemo(() => {
    const values = remainingLeads
      .map((lead) => normalizeText(lead.industry))
      .filter((value) => value && value !== "-");
    return ["All Industries", ...Array.from(new Set(values)).sort(compareText)];
  }, [remainingLeads]);

  const filteredLeads = useMemo(() => {
    const query = normalizeText(searchQuery).toLowerCase();
    const rows = remainingLeads.filter((lead) => {
      const matchesIndustry = selectedIndustry === "All Industries" || lead.industry === selectedIndustry;
      if (!matchesIndustry) return false;
      if (!query) return true;

      return [
        lead.company,
        lead.industry,
        lead.location,
        lead.employees,
        lead.turnover,
        lead.phone,
        lead.email,
        lead.source,
        lead.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    return [...rows].sort((a, b) => {
      const generatedA = a.generatedAt ? new Date(a.generatedAt).getTime() : 0;
      const generatedB = b.generatedAt ? new Date(b.generatedAt).getTime() : 0;
      if (sortBy === "company-desc") return compareText(b.company, a.company);
      if (sortBy === "industry-asc") return compareText(a.industry, b.industry) || compareText(a.company, b.company);
      if (sortBy === "industry-desc") return compareText(b.industry, a.industry) || compareText(a.company, b.company);
      if (sortBy === "generated-desc") return generatedB - generatedA || compareText(a.company, b.company);
      if (sortBy === "generated-asc") return generatedA - generatedB || compareText(a.company, b.company);
      if (sortBy === "rating-desc") return Number(b.rating || 0) - Number(a.rating || 0) || compareText(a.company, b.company);
      if (sortBy === "reviews-desc") return Number(b.reviewsCount || 0) - Number(a.reviewsCount || 0) || compareText(a.company, b.company);
      return compareText(a.company, b.company);
    });
  }, [remainingLeads, searchQuery, selectedIndustry, sortBy]);

  useEffect(() => {
    setSelectedLeadIds((prev) =>
      prev.filter((id) => remainingLeads.some((lead) => String(lead._id) === id))
    );
  }, [remainingLeads]);

  const filteredLeadIds = useMemo(
    () => filteredLeads.map((lead) => String(lead._id || "")).filter(Boolean),
    [filteredLeads]
  );
  const allFilteredSelected =
    filteredLeadIds.length > 0 && filteredLeadIds.every((id) => selectedLeadIds.includes(id));

  const toggleLeadSelection = (leadId) => {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  };

  const toggleSelectAllFiltered = () => {
    setSelectedLeadIds((prev) => {
      if (allFilteredSelected) {
        return prev.filter((id) => !filteredLeadIds.includes(id));
      }
      return Array.from(new Set([...prev, ...filteredLeadIds]));
    });
  };

  const handleBulkImportSelected = async () => {
    if (!selectedLeadIds.length || bulkImporting || importingId) return;
    setBulkImporting(true);
    setError("");
    try {
      for (const leadId of selectedLeadIds) {
        const ok = await handleImport(leadId);
        if (!ok) break;
      }
      await loadAiLeads();
      setSelectedLeadIds([]);
    } finally {
      setBulkImporting(false);
    }
  };

  const totalLeads = Number(summary.total || remainingLeads.length || 0);
  const importedLeads = Number(summary.imported || 0);
  const industryCount = Number(summary.industries || Math.max(0, industryOptions.length - 1));
  const todayFetchedCount = Number(summary.todayFetchedCount || 0);

  return (
    <div className="aiLead-container">
      <div className="aiLead-cardGrid">
        <div className="aiLead-summaryCard">
          <h3>{loading ? "..." : totalLeads}</h3>
          <p>fetched Leads</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{loading ? "..." : importedLeads}</h3>
          <p>Imported to Pipeline</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{loading ? "..." : industryCount}</h3>
          <p>Industries Found</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{loading ? "..." : `${todayFetchedCount} new`}</h3>
          <p>Today's Fetch</p>
        </div>
      </div>

      <div className="aiLead-tableSection">
        <div className="aiLead-tableHeader">
          <div className="aiLead-filterRow">
            <label className="aiLead-filterLabel aiLead-searchLabel">
              Search
              <input
                className="aiLead-searchInput"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, phone, email, location..."
              />
            </label>

            <label className="aiLead-filterLabel">
              Industry
              <select
                className="aiLead-filterSelect"
                value={selectedIndustry}
                onChange={(event) => setSelectedIndustry(event.target.value)}
              >
                {industryOptions.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </select>
            </label>

            <label className="aiLead-filterLabel">
              Sort
              <select
                className="aiLead-filterSelect"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
              >
                <option value="company-asc">Company A-Z</option>
                <option value="company-desc">Company Z-A</option>
                <option value="industry-asc">Industry A-Z</option>
                <option value="industry-desc">Industry Z-A</option>
                <option value="generated-desc">Generated Newest</option>
                <option value="generated-asc">Generated Oldest</option>
              </select>
            </label>
          </div>
        </div>

        <table className="aiLead-table crm-auto-responsive-table">
          <thead>
            <tr>
              <th className="aiLead-checkCol" data-label="Select">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  disabled={!filteredLeadIds.length}
                  aria-label="Select all visible AI leads"
                />
              </th>
              <th>Company</th>
              <th>Industry</th>
              <th>Location</th>
              <th>Employees</th>
              <th>Turnover</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="aiLead-emptyCell" colSpan={9}>
                  Loading fetched leads...
                </td>
              </tr>
            )}

            {!loading && filteredLeads.map((lead) => {
              const leadId = String(lead._id || "");
              const isImporting = importingId === leadId;
              const checked = selectedLeadIds.includes(leadId);

              return (
                <tr
                  key={leadId || lead.company}
                  className="aiLead-clickableRow"
                  onClick={() => setSelectedLead(lead)}
                >
                  <td className="aiLead-checkCol">
                    <input
                      type="checkbox"
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleLeadSelection(leadId)}
                      aria-label={`Select ${lead.company || "lead"}`}
                    />
                  </td>
                  <td>{lead.company || "-"}</td>
                  <td>{lead.industry || "-"}</td>
                  <td>{lead.location || "-"}</td>
                  <td>{lead.employees || "-"}</td>
                  <td>{lead.turnover || "-"}</td>
                  <td>{lead.phone || "-"}</td>
                  <td>{lead.email || "-"}</td>
                  <td>
                    <button
                      className="aiLead-importBtn"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleImport(leadId);
                      }}
                      disabled={isImporting || bulkImporting}
                    >
                      {isImporting ? "Importing..." : "Import"}
                    </button>
                  </td>
                </tr>
              );
            })}

            {!loading && filteredLeads.length === 0 && (
              <tr>
                <td className="aiLead-emptyCell" colSpan={9}>
                  No fetched leads found for the selected industry.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="aiLead-bulkBar">
          <p>
            Showing {filteredLeads.length} of {totalLeads} fetched leads
            {summary.lastImportedCount || summary.lastUpdatedCount
              ? ` | Last sync: ${summary.lastImportedCount || 0} new, ${summary.lastUpdatedCount || 0} updated`
              : ""}
          </p>
          <div className="aiLead-bulkActions">
            <button
              type="button"
              className="aiLead-bulkPrimary"
              onClick={handleBulkImportSelected}
              disabled={!selectedLeadIds.length || bulkImporting || Boolean(importingId)}
            >
              {bulkImporting ? "Importing..." : `Import Selected (${selectedLeadIds.length})`}
            </button>
          </div>
        </div>
        {error && <p className="aiLead-errorText">{error}</p>}
      </div>

      {selectedLead ? (
        <div className="aiLead-modalOverlay" role="presentation" onClick={() => setSelectedLead(null)}>
          <div className="aiLead-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="aiLead-modalHeader">
              <div>
                <h3>{selectedLead.company || "AI Lead Details"}</h3>
                <p>{selectedLead.industry || "-"} | {selectedLead.location || "-"}</p>
              </div>
              <button type="button" className="aiLead-modalClose" onClick={() => setSelectedLead(null)}>
                x
              </button>
            </div>

            <div className="aiLead-detailGrid">
              {[
                ["Company", selectedLead.company],
                ["Industry", selectedLead.industry],
                ["Location", selectedLead.location],
                ["Employees", selectedLead.employees],
                ["Turnover", selectedLead.turnover],
                ["Phone", selectedLead.phone],
                ["Email", selectedLead.email],
                ["Website", selectedLead.website],
                ["Source", selectedLead.source],
                ["Decision Maker", selectedLead.decisionMaker],
                ["Rating", selectedLead.rating],
                ["Reviews", selectedLead.reviewsCount],
                ["Generated At", selectedLead.generatedAt ? new Date(selectedLead.generatedAt).toLocaleString("en-IN") : ""],
                ["Status", selectedLead.status],
              ].map(([label, value]) => (
                <div className="aiLead-detailItem" key={label}>
                  <span>{label}</span>
                  <strong>{value === null || value === undefined || value === "" ? "-" : value}</strong>
                </div>
              ))}
            </div>

            <div className="aiLead-modalActions">
              <button
                className="aiLead-importBtn"
                type="button"
                onClick={async () => {
                  const ok = await handleImport(String(selectedLead._id || ""));
                  if (ok) setSelectedLead(null);
                }}
                disabled={importingId === String(selectedLead._id || "") || bulkImporting}
              >
                {importingId === String(selectedLead._id || "") ? "Importing..." : "Import Lead"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
