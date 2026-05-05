import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import "./styles/AILeadGeneration.css";

function formatDateTime(value) {
  if (!value) return "Not run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not run yet";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
      setError(err?.response?.data?.message || "Failed to load scraped leads.");
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
    const rows = remainingLeads.filter((lead) => {
      return selectedIndustry === "All Industries" || lead.industry === selectedIndustry;
    });

    return [...rows].sort((a, b) => {
      if (sortBy === "company-desc") return compareText(b.company, a.company);
      if (sortBy === "industry-asc") return compareText(a.industry, b.industry) || compareText(a.company, b.company);
      if (sortBy === "industry-desc") return compareText(b.industry, a.industry) || compareText(a.company, b.company);
      if (sortBy === "rating-desc") return Number(b.rating || 0) - Number(a.rating || 0) || compareText(a.company, b.company);
      if (sortBy === "reviews-desc") return Number(b.reviewsCount || 0) - Number(a.reviewsCount || 0) || compareText(a.company, b.company);
      return compareText(a.company, b.company);
    });
  }, [remainingLeads, selectedIndustry, sortBy]);

  useEffect(() => {
    setSelectedLeadIds((prev) =>
      prev.filter((id) => remainingLeads.some((lead) => String(lead._id) === id))
    );
  }, [remainingLeads]);

  const toggleLeadSelection = (leadId) => {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
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
  const lastRunText = formatDateTime(summary.lastRunAt);

  return (
    <div className="aiLead-container">
      <div className="aiLead-cardGrid">
        <div className="aiLead-summaryCard">
          <h3>{loading ? "..." : totalLeads}</h3>
          <p>Scraped Leads</p>
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
          <h3>{summary.lastRunStatus || "Waiting"}</h3>
          <p>{lastRunText}</p>
        </div>
      </div>

      <div className="aiLead-tableSection">
        <div className="aiLead-tableHeader">
          <div className="aiLead-filterRow">
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
                <option value="rating-desc">Rating High-Low</option>
                <option value="reviews-desc">Reviews High-Low</option>
              </select>
            </label>

            <button className="aiLead-refreshBtn" type="button" onClick={loadAiLeads} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <table className="aiLead-table">
          <thead>
            <tr>
              <th className="aiLead-checkCol"></th>
              <th>Company</th>
              <th>Industry</th>
              <th>Source</th>
              <th>Location</th>
              <th>Employees</th>
              <th>Turnover</th>
              <th>Decision Maker</th>
              <th>Rating</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="aiLead-emptyCell" colSpan={10}>
                  Loading scraped leads...
                </td>
              </tr>
            )}

            {!loading && filteredLeads.map((lead) => {
              const leadId = String(lead._id || "");
              const isImporting = importingId === leadId;
              const checked = selectedLeadIds.includes(leadId);
              const rating = Number(lead.rating || 0);
              const reviews = Number(lead.reviewsCount || 0);

              return (
                <tr key={leadId || lead.company}>
                  <td className="aiLead-checkCol">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLeadSelection(leadId)}
                      aria-label={`Select ${lead.company || "lead"}`}
                    />
                  </td>
                  <td>{lead.company || "-"}</td>
                  <td>{lead.industry || "-"}</td>
                  <td>{lead.source || "-"}</td>
                  <td>{lead.location || "-"}</td>
                  <td>{lead.employees || "-"}</td>
                  <td>{lead.turnover || "-"}</td>
                  <td>{lead.decisionMaker || "-"}</td>
                  <td>{rating ? `${rating}${reviews ? ` (${reviews})` : ""}` : "-"}</td>
                  <td>
                    <button
                      className="aiLead-importBtn"
                      type="button"
                      onClick={() => handleImport(leadId)}
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
                <td className="aiLead-emptyCell" colSpan={10}>
                  No scraped leads found for the selected industry.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="aiLead-bulkBar">
          <p>
            Showing {filteredLeads.length} of {totalLeads} scraped leads
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
    </div>
  );
}
