import React, { useEffect, useMemo, useState } from "react";
import API from "../../api";
import "./styles/AILeadGeneration.css";

const getBadgeClass = (score) => {
  if (score >= 90) return "aiLead-badge aiLead-badge-perfect";
  if (score >= 80) return "aiLead-badge aiLead-badge-excellent";
  if (score >= 70) return "aiLead-badge aiLead-badge-good";
  return "aiLead-badge aiLead-badge-weak";
};

export default function AILeadGeneration() {
  const dummyWonDeals = [
    { id: "dummy-1", label: "Solar Plant - Pune" },
    { id: "dummy-2", label: "Wind Project - Nashik" }
  ];
  const dummyAiLeads = [
    {
      _id: "dummy-ai-1",
      company: "Maharashtra Solar Energy",
      industry: "Solar EPC",
      source: "LinkedIn",
      location: "Pune, MH",
      employees: "50-100",
      turnover: "Rs. 25-50Cr",
      decisionMaker: "Rajesh Patil (CEO)",
      score: 94,
      similarityLabel: "Perfect Match",
      generatedAt: "2026-03-04T09:00:00.000Z",
      status: "New"
    },
    {
      _id: "dummy-ai-2",
      company: "Renewable Power Systems",
      industry: "Solar EPC",
      source: "IndiaMART",
      location: "Mumbai, MH",
      employees: "100-200",
      turnover: "Rs. 50-100Cr",
      decisionMaker: "Anita Sharma (Director)",
      score: 91,
      similarityLabel: "Excellent Match",
      generatedAt: "2026-03-02T10:30:00.000Z",
      status: "New"
    },
    {
      _id: "dummy-ai-3",
      company: "GreenTech Energy Pvt Ltd",
      industry: "Solar & Wind",
      source: "TradeIndia",
      location: "Bangalore, KA",
      employees: "200-500",
      turnover: "Rs. 100-250Cr",
      decisionMaker: "Suresh Kumar (VP Ops)",
      score: 86,
      similarityLabel: "Excellent Match",
      generatedAt: "2026-03-01T08:15:00.000Z",
      status: "New"
    },
    {
      _id: "dummy-ai-4",
      company: "SunRise Solar Solutions",
      industry: "Solar EPC",
      source: "LinkedIn",
      location: "Nashik, MH",
      employees: "20-50",
      turnover: "Rs. 10-25Cr",
      decisionMaker: "Vikram Deshmukh (MD)",
      score: 79,
      similarityLabel: "Good Match",
      generatedAt: "2026-02-27T11:00:00.000Z",
      status: "New"
    },
    {
      _id: "dummy-ai-5",
      company: "EcoVolt Renewables",
      industry: "Energy Storage",
      source: "IndiaMART",
      location: "Ahmedabad, GJ",
      employees: "80-150",
      turnover: "Rs. 30-60Cr",
      decisionMaker: "Neha Patel (Business Head)",
      score: 73,
      similarityLabel: "Good Match",
      generatedAt: "2026-02-20T08:15:00.000Z",
      status: "New"
    }
  ];

  const [leads, setLeads] = useState(dummyAiLeads);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importingId, setImportingId] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [wonDealOptions, setWonDealOptions] = useState(dummyWonDeals);
  const [selectedWonDealId, setSelectedWonDealId] = useState("");
  const [selectedSource, setSelectedSource] = useState("All Sources");
  const [selectedScoreBand, setSelectedScoreBand] = useState("All Similarity Scores");
  const [selectedDateRange, setSelectedDateRange] = useState("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");

  useEffect(() => {
    const loadAiLeads = async () => {
      try {
        setLoading(true);
        setError("");
        const { data } = await API.get("/ai-leads");
        const apiItems = Array.isArray(data?.items) ? data.items : [];
        if (apiItems.length > 0) {
          setLeads(apiItems);
        }
      } catch (err) {
        setError(err?.response?.data?.message || "");
      } finally {
        setLoading(false);
      }
    };

    loadAiLeads();
  }, []);

  useEffect(() => {
    const loadWonDeals = async () => {
      try {
        const { data } = await API.get("/deals");
        const dealsList = Array.isArray(data) ? data : [];

        const wonDeals = dealsList
          .filter((deal) => String(deal?.status || "").toLowerCase() === "won")
          .map((deal) => ({
            id: String(deal?._id || ""),
            label: deal?.company_name || "Untitled Deal"
          }))
          .filter((deal) => deal.id && deal.label);

        if (wonDeals.length > 0) {
          setWonDealOptions(wonDeals);
          setSelectedWonDealId("");
        }
      } catch {
        // Keep dummy options when deals are unavailable.
      }
    };

    loadWonDeals();
  }, []);

  const handleImport = async (leadId) => {
    if (!leadId || importingId || bulkImporting) return false;
    if (leadId.startsWith("dummy-ai-")) {
      setLeads((prev) => prev.filter((lead) => String(lead._id) !== leadId));
      return true;
    }

    try {
      setImportingId(leadId);
      setError("");
      await API.post(`/ai-leads/${leadId}/import`);
      setLeads((prev) => prev.filter((lead) => String(lead._id) !== leadId));
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to import lead.");
      return false;
    } finally {
      setImportingId("");
    }
  };

  const sourceOptions = useMemo(
    () => ["All Sources", ...Array.from(new Set(leads.map((lead) => lead.source)))],
    [leads]
  );

  const remainingLeads = useMemo(
    () => leads.filter((lead) => String(lead.status || "").toLowerCase() !== "imported"),
    [leads]
  );

  const filteredLeads = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = remainingLeads.filter((lead) => {
      const sourceMatch = selectedSource === "All Sources" || lead.source === selectedSource;

      let scoreMatch = true;
      if (selectedScoreBand === "90-100") scoreMatch = lead.score >= 90;
      if (selectedScoreBand === "80-89") scoreMatch = lead.score >= 80 && lead.score <= 89;
      if (selectedScoreBand === "70-79") scoreMatch = lead.score >= 70 && lead.score <= 79;
      if (selectedScoreBand === "<70") scoreMatch = lead.score < 70;

      const rawDate = lead.generatedAt || lead.createdAt || lead.created_at || null;
      const leadDate = rawDate ? new Date(rawDate) : null;
      const validDate = leadDate && !Number.isNaN(leadDate.getTime());

      let dateMatch = true;
      if (selectedDateRange !== "all") {
        if (!validDate) {
          dateMatch = false;
        } else if (selectedDateRange === "today") {
          const end = new Date(startOfToday);
          end.setDate(end.getDate() + 1);
          dateMatch = leadDate >= startOfToday && leadDate < end;
        } else if (selectedDateRange === "last7") {
          const start = new Date(startOfToday);
          start.setDate(start.getDate() - 6);
          const end = new Date(startOfToday);
          end.setDate(end.getDate() + 1);
          dateMatch = leadDate >= start && leadDate < end;
        } else if (selectedDateRange === "last30") {
          const start = new Date(startOfToday);
          start.setDate(start.getDate() - 29);
          const end = new Date(startOfToday);
          end.setDate(end.getDate() + 1);
          dateMatch = leadDate >= start && leadDate < end;
        } else if (selectedDateRange === "thisMonth") {
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          dateMatch = leadDate >= start && leadDate < end;
        } else if (selectedDateRange === "custom") {
          const hasFrom = Boolean(customFromDate);
          const hasTo = Boolean(customToDate);

          if (!hasFrom && !hasTo) {
            dateMatch = true;
          } else {
            const from = hasFrom ? new Date(`${customFromDate}T00:00:00`) : null;
            const to = hasTo ? new Date(`${customToDate}T23:59:59`) : null;
            if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
              dateMatch = false;
            } else {
              dateMatch = (!from || leadDate >= from) && (!to || leadDate <= to);
            }
          }
        }
      }

      return sourceMatch && scoreMatch && dateMatch;
    });

    return filtered.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }, [
    customFromDate,
    customToDate,
    remainingLeads,
    selectedDateRange,
    selectedScoreBand,
    selectedSource
  ]);

  useEffect(() => {
    setSelectedLeadIds((prev) =>
      prev.filter((id) => leads.some((lead) => String(lead._id) === id))
    );
  }, [leads]);

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
      setSelectedLeadIds([]);
    } finally {
      setBulkImporting(false);
    }
  };

  const totalLeads = leads.length;
  const importedLeads = leads.filter((lead) => lead.status === "Imported").length;
  const conversionRate = totalLeads ? ((importedLeads / totalLeads) * 100).toFixed(1) : "0.0";
  const avgScore = totalLeads
    ? Math.round(leads.reduce((acc, lead) => acc + Number(lead.score || 0), 0) / totalLeads)
    : 0;

  return (
    <div className="aiLead-container">
      <h2 className="aiLead-title">AI Lead Generation</h2>

      <div className="aiLead-cardGrid">
        <div className="aiLead-summaryCard">
          <h3>{totalLeads}</h3>
          <p>AI Generated Leads</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{importedLeads}</h3>
          <p>Imported to Pipeline</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{conversionRate}%</h3>
          <p>Conversion Rate</p>
        </div>
        <div className="aiLead-summaryCard">
          <h3>{avgScore}/100</h3>
          <p>Avg Similarity Score</p>
        </div>
      </div>

      <div className="aiLead-generateSection">
        <h3>Generate Similar Leads</h3>

        <div className="aiLead-formRow">
          <select
            className="aiLead-select"
            value={selectedWonDealId}
            onChange={(event) => setSelectedWonDealId(event.target.value)}
          >
            <option value="">Select Won Deal</option>
            {wonDealOptions.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.label}
              </option>
            ))}
          </select>

          <select className="aiLead-select">
            <option>Generate 50 Leads</option>
            <option>Generate 100 Leads</option>
          </select>

          <button className="aiLead-generateBtn" type="button">Generate with AI</button>
        </div>
      </div>

      <div className="aiLead-tableSection">
        <div className="aiLead-tableHeader">
          <h3>Latest AI Generated Leads</h3>
          <div className="aiLead-filterRow">
            <label className="aiLead-filterLabel">
              Source
              <select
                className="aiLead-filterSelect"
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value)}
              >
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>

            <label className="aiLead-filterLabel">
              AI Similarity Score
              <select
                className="aiLead-filterSelect"
                value={selectedScoreBand}
                onChange={(event) => setSelectedScoreBand(event.target.value)}
              >
                <option>All Similarity Scores</option>
                <option>90-100</option>
                <option>80-89</option>
                <option>70-79</option>
                <option>&lt;70</option>
              </select>
            </label>

            <label className="aiLead-filterLabel">
              Date
              <select
                className="aiLead-filterSelect"
                value={selectedDateRange}
                onChange={(event) => setSelectedDateRange(event.target.value)}
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="last7">Last 7 Days</option>
                <option value="last30">Last 30 Days</option>
                <option value="thisMonth">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>

            {selectedDateRange === "custom" && (
              <>
                <label className="aiLead-filterLabel">
                  From
                  <input
                    className="aiLead-filterSelect aiLead-filterDate"
                    type="date"
                    value={customFromDate}
                    onChange={(event) => setCustomFromDate(event.target.value)}
                  />
                </label>
                <label className="aiLead-filterLabel">
                  To
                  <input
                    className="aiLead-filterSelect aiLead-filterDate"
                    type="date"
                    value={customToDate}
                    onChange={(event) => setCustomToDate(event.target.value)}
                  />
                </label>
              </>
            )}
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
              <th>Similarity Score</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td className="aiLead-emptyCell" colSpan={10}>
                  Loading AI leads...
                </td>
              </tr>
            )}

            {!loading && filteredLeads.map((lead) => {
              const leadId = String(lead._id || "");
              const isImporting = importingId === leadId;
              const checked = selectedLeadIds.includes(leadId);

              const score = Number(lead.score || 0);
              const label = lead.similarityLabel || (score >= 90
                ? "Perfect Match"
                : score >= 80
                  ? "Excellent Match"
                  : score >= 70
                    ? "Good Match"
                    : "Match");

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
                  <td>
                    <span className={getBadgeClass(score)}>
                      {score} - {label}
                    </span>
                  </td>
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
                  No leads found for selected source and similarity range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="aiLead-bulkBar">
          <p>Showing {filteredLeads.length} of {totalLeads} AI-generated leads</p>
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

      <div className="aiLead-insightsWrapper">
        <h3 className="aiLead-insightsTitle">AI Lead Generation Insights</h3>
        <div className="aiLead-insightsSection">
          <div className="aiLead-insightCard">
            <h4>High Quality Sources</h4>
            <p>94 companies found from LinkedIn & IndiaMART</p>
          </div>

          <div className="aiLead-insightCard">
            <h4>Best Matches</h4>
            <p>23 companies with similarity score above 85</p>
          </div>

          <div className="aiLead-insightCard">
            <h4>Location Focus</h4>
            <p>68% matches from Maharashtra region</p>
          </div>
        </div>
      </div>
    </div>
  );
}
