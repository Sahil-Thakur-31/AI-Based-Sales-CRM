import React, { useEffect, useState } from "react";
import API from "../../../api";

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function matchesLeadTableFilter(row, filterValue) {
  switch (filterValue) {
    case "contacted":
      return row.isContacted;
    case "uncontacted":
      return !row.isContacted;
    case "converted":
      return row.isConverted;
    case "notConverted":
      return !row.isConverted;
    case "qualified":
      return String(row.status || "").toLowerCase() === "qualified";
    case "rejected":
      return String(row.status || "").toLowerCase() === "rejected";
    case "hot":
    case "warm":
    case "cold":
      return String(row.leadTemperature || "").toLowerCase() === filterValue;
    default:
      return true;
  }
}

function escapeCsvValue(value) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function buildLeadKpiCards(reportData, loading, error) {
  if (loading) {
    return [
      { key: "totalLeads", value: "Loading...", label: "Total Leads", meta: "Fetching live lead data", tone: "neutral" },
      { key: "contacted", value: "Loading...", label: "Contacted", meta: "Fetching live lead data", tone: "neutral" },
      { key: "uncontacted", value: "Loading...", label: "Uncontacted", meta: "Fetching live lead data", tone: "neutral" },
      { key: "converted", value: "Loading...", label: "Converted", meta: "Fetching live lead data", tone: "neutral" },
      { key: "notConverted", value: "Loading...", label: "Not Converted", meta: "Fetching live lead data", tone: "neutral" },
    ];
  }

  if (error || !reportData?.kpis) {
    return [
      { key: "totalLeads", value: "--", label: "Total Leads", meta: "Unable to load KPI data", tone: "warning" },
      { key: "contacted", value: "--", label: "Contacted", meta: "Unable to load KPI data", tone: "warning" },
      { key: "uncontacted", value: "--", label: "Uncontacted", meta: "Unable to load KPI data", tone: "warning" },
      { key: "converted", value: "--", label: "Converted", meta: "Unable to load KPI data", tone: "warning" },
      { key: "notConverted", value: "--", label: "Not Converted", meta: "Unable to load KPI data", tone: "warning" },
    ];
  }

  const { kpis } = reportData;

  return [
    { key: "totalLeads", value: formatCount(kpis.total), label: "Leads", meta: "Total in period", tone: "neutral" },
    { key: "contacted", value: formatCount(kpis.contacted), label: "Contacted", meta: "Has recorded activity", tone: "positive" },
    { key: "uncontacted", value: formatCount(kpis.uncontacted), label: "Uncontacted", meta: "Needs first action", tone: kpis.uncontacted > 0 ? "warning" : "neutral" },
    { key: "converted", value: formatCount(kpis.converted), label: "Converted", meta: "Turned to deals", tone: "positive" },
    { key: "notConverted", value: formatCount(kpis.notConverted), label: "Not Converted", meta: "Still needs closure", tone: kpis.notConverted > 0 ? "warning" : "neutral" },
  ];
}

export default function LeadsTab({ period = "monthly" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoveredPointIndex, setHoveredPointIndex] = useState(null);
  const [tableFilter, setTableFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    API.get("/leads/reports/analytics", { params: { period } })
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error("Failed to load leads analytics:", err);
        setError("Failed to load analytics");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const kpiCards = buildLeadKpiCards(data, loading, error);
  const funnel = data?.funnel || [];
  const kpis = data?.kpis || {};
  const trend = data?.leadsTrend || [];
  const funnelMax = Math.max(...funnel.map((f) => f.count), 1);
  const sourcePerformance = data?.sourcePerformance || [];
  const leadQuality = data?.leadQuality || [];
  const leadAging = data?.leadAging || [];
  const tableRows = data?.tableRows || [];
  const filteredLeadRows = tableRows.filter((row) => matchesLeadTableFilter(row, tableFilter));

  const qualityMap = { hot: 0, warm: 0, cold: 0 };
  leadQuality.forEach((q) => {
    qualityMap[q._id || "cold"] = q.count;
  });

  function handleExportExcel() {
    const headers = [
      "Company",
      "Created On",
      "Source",
      "Status",
      "Activity",
      "Temperature",
      "Assigned To",
      "Follow-Ups",
      "Meetings",
    ];

    const csvRows = filteredLeadRows.map((row) => [
      row.companyName || "Unnamed Lead",
      formatDate(row.createdAt),
      row.sourceLabel || "Unknown",
      row.status || "new",
      row.isContacted ? "Contacted" : "Not Contacted",
      row.leadTemperature || "cold",
      row.assignedToName || "Unassigned",
      Number(row.totalFollowups || 0),
      Number(row.meetingCount || 0),
    ]);

    const csvContent = [
      headers.map(escapeCsvValue).join(","),
      ...csvRows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-report-${period}-${tableFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="leads-tab">
      <section className="kpi-grid">
        {kpiCards.map((card) => (
          <div key={card.key} className={`kpi-card ${card.tone}`}>
            <div className="kpi-value">{card.value}</div>
            <span>{card.label}</span>
            <div className="kpi-meta">{card.meta}</div>
          </div>
        ))}
      </section>

      <section className="reports-card">
        <h2 className="reports-card-title">Leads Analytics</h2>
        {trend.length === 0 ? (
          <div className="chart-box" style={{ color: "#9ca3af" }}>No lead data yet</div>
        ) : (
          <div style={{ width: "100%", padding: "8px 0" }}>
            {(() => {
              const W = 800;
              const H = 240;
              const pad = { top: 20, right: 20, bottom: 52, left: 58 };
              const innerW = W - pad.left - pad.right;
              const innerH = H - pad.top - pad.bottom;
              const maxVal = Math.max(...trend.map((row) => row.total), 5);
              const niceMax = Math.ceil(maxVal / 5) * 5;
              const xStep = innerW / Math.max(trend.length - 1, 1);
              const yScale = (value) => pad.top + (1 - value / niceMax) * innerH;
              const pts = trend.map((row, index) => ({
                x: pad.left + index * xStep,
                y: yScale(row.total),
                ...row,
              }));
              const linePath = pts.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
              const yTicks = Array.from({ length: 6 }, (_, index) => (niceMax / 5) * index).reverse();
              const xLabelInterval = Math.max(1, Math.ceil(trend.length / 8));
              const hoveredPoint =
                hoveredPointIndex !== null && hoveredPointIndex >= 0 && hoveredPointIndex < pts.length
                  ? pts[hoveredPointIndex]
                  : null;

              return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.1" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {yTicks.map((tick) => (
                    <g key={tick}>
                      <line
                        x1={pad.left}
                        x2={W - pad.right}
                        y1={yScale(tick)}
                        y2={yScale(tick)}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                      />
                      <text
                        x={pad.left - 10}
                        y={yScale(tick) + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="#94a3b8"
                      >
                        {Math.round(tick)}
                      </text>
                    </g>
                  ))}
                  <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
                  <line x1={pad.left} x2={W - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
                  <path d={`${linePath} L${pts[pts.length - 1].x},${pad.top + innerH} L${pts[0].x},${pad.top + innerH} Z`} fill="url(#leadGrad)" />
                  <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
                  {hoveredPoint && (
                    <g pointerEvents="none">
                      <line
                        x1={hoveredPoint.x}
                        x2={hoveredPoint.x}
                        y1={pad.top}
                        y2={pad.top + innerH}
                        stroke="#93c5fd"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                      <rect
                        x={Math.min(Math.max(hoveredPoint.x - 48, pad.left), W - pad.right - 96)}
                        y={Math.max(hoveredPoint.y - 44, pad.top + 4)}
                        width="96"
                        height="36"
                        rx="8"
                        fill="#0f172a"
                        opacity="0.96"
                      />
                      <text
                        x={Math.min(Math.max(hoveredPoint.x, pad.left + 48), W - pad.right - 48)}
                        y={Math.max(hoveredPoint.y - 29, pad.top + 18)}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#f8fafc"
                      >
                        {hoveredPoint.label}
                      </text>
                      <text
                        x={Math.min(Math.max(hoveredPoint.x, pad.left + 48), W - pad.right - 48)}
                        y={Math.max(hoveredPoint.y - 16, pad.top + 31)}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#bfdbfe"
                      >
                        {`${hoveredPoint.total} lead${hoveredPoint.total === 1 ? "" : "s"}`}
                      </text>
                    </g>
                  )}
                  {pts.map((point, index) => (
                    <g key={index}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={hoveredPointIndex === index ? "5" : "3"}
                        fill="#3b82f6"
                        stroke="#fff"
                        strokeWidth="1"
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHoveredPointIndex(index)}
                        onMouseLeave={() => setHoveredPointIndex(null)}
                      >
                        <title>{`${point.label}: ${point.total} lead${point.total === 1 ? "" : "s"}`}</title>
                      </circle>
                      {(index % xLabelInterval === 0 || index === pts.length - 1) && (
                        <>
                          <line
                            x1={point.x}
                            x2={point.x}
                            y1={pad.top + innerH}
                            y2={pad.top + innerH + 5}
                            stroke="#cbd5e1"
                            strokeWidth="1"
                          />
                          <text x={point.x} y={H - 18} textAnchor="middle" fontSize="10" fill="#94a3b8">
                            {point.label}
                          </text>
                        </>
                      )}
                    </g>
                  ))}
                  <text x={pad.left + innerW / 2} y={H - 2} textAnchor="middle" fontSize="11" fill="#64748b">
                    Date
                  </text>
                  <text
                    x="14"
                    y={pad.top + innerH / 2}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#64748b"
                    transform={`rotate(-90 14 ${pad.top + innerH / 2})`}
                  >
                    Leads
                  </text>
                </svg>
              );
            })()}
          </div>
        )}
      </section>

      <section className="reports-card">
        <h2 className="reports-card-title">Conversion Analytics</h2>
        <h4 style={{ margin: "0 0 16px", fontSize: 14, color: "#475569", fontWeight: 500 }}>Lead Funnel Journey</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" }}>
          {funnel.map((step, index) => {
            const pct = Math.max(0, Math.min(100, funnelMax > 0 ? (step.count / funnelMax) * 100 : 0));
            const colors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b"];
            return (
              <div key={step.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                    {index > 0 ? "v " : ""}
                    {step.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{step.count}</span>
                </div>
                <div style={{ paddingRight: "20px" }}>
                  <div style={{ background: "#e2e8f0", borderRadius: 4, height: 10 }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        background: colors[index] || "#6366f1",
                        height: "100%",
                        borderRadius: 4,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
          {[
            { label: "Lead to Contacted", value: funnel[0]?.count ? Math.min(100, Math.round((funnel[1]?.count / funnel[0]?.count) * 100)) : 0 },
            { label: "Contacted to Qualified", value: funnel[1]?.count ? Math.min(100, Math.round((funnel[2]?.count / funnel[1]?.count) * 100)) : 0 },
            { label: "Overall Conversion", value: funnel[0]?.count ? Math.min(100, Math.round((funnel[3]?.count / funnel[0]?.count) * 100)) : 0 },
          ].map((metric) => (
            <div key={metric.label} style={{ flex: 1, minWidth: 120, background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#334155" }}>{metric.value}%</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.025em" }}>{metric.label}</div>
            </div>
          ))}
        </div>

        {kpis.total > 0 && kpis.converted !== undefined && (
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary, #64748b)" }}>
            Conversion rate: <strong>{Math.min(100, ((kpis.converted / kpis.total) * 100)).toFixed(1)}%</strong>
          </p>
        )}
      </section>

      <section className="reports-card">
        <h2 className="reports-card-title">Source Performance</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" }}>
          {sourcePerformance.length === 0 ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>No source data</p>
          ) : (
            sourcePerformance.map((source, index) => {
              const conv = source.total > 0 ? Math.round((source.converted / source.total) * 100) : 0;
              return (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", background: "#f8fafc", padding: "12px 16px", borderRadius: "8px", alignItems: "center", border: "1px solid #f1f5f9" }}>
                  <div style={{ fontWeight: 600, color: "#334155", minWidth: 100 }}>{source.label}</div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>{source.total} leads</div>
                  <div style={{ fontWeight: 700, color: conv >= 20 ? "#10b981" : "#3b82f6", width: 80, textAlign: "right" }}>{conv}% conv</div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
        <section className="reports-card">
          <h2 className="reports-card-title">Lead Quality</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#fff1f2", borderLeft: "4px solid #f43f5e", borderRadius: "0 8px 8px 0" }}>
              <span style={{ fontWeight: 600, color: "#9f1239" }}>Hot</span>
              <span style={{ fontWeight: 700, color: "#881337" }}>{qualityMap.hot || 0} leads</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#fffbeb", borderLeft: "4px solid #f59e0b", borderRadius: "0 8px 8px 0" }}>
              <span style={{ fontWeight: 600, color: "#b45309" }}>Warm</span>
              <span style={{ fontWeight: 700, color: "#78350f" }}>{qualityMap.warm || 0} leads</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#f0f9ff", borderLeft: "4px solid #3b82f6", borderRadius: "0 8px 8px 0" }}>
              <span style={{ fontWeight: 600, color: "#1e3a8a" }}>Cold</span>
              <span style={{ fontWeight: 700, color: "#172554" }}>{qualityMap.cold || 0} leads {qualityMap.cold > 0 ? "!" : ""}</span>
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: "#64748b", fontWeight: 500 }}>Cold leads need nurturing.</p>
        </section>

        <section className="reports-card">
          <h2 className="reports-card-title">Lead Aging (Unconverted)</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            {leadAging.map((age, index) => (
              <div key={age.label} style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                <span style={{ color: "#475569", fontWeight: 600 }}>{age.label}</span>
                <span style={{ fontWeight: 700, color: index === 2 && age.count > 0 ? "#ef4444" : "#334155" }}>
                  {age.count} leads {index === 2 && age.count > 0 ? "!" : ""}
                </span>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: "#64748b", fontWeight: 500 }}>Old leads are high risk.</p>
        </section>
      </div>

      <section className="reports-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="reports-card-title" style={{ marginBottom: 4 }}>Leads Table</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              {filteredLeadRows.length} of {tableRows.length} leads in this period
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              className="report-filter"
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value)}
            >
              <option value="all">All Leads</option>
              <option value="contacted">Contacted</option>
              <option value="uncontacted">Not Contacted</option>
              <option value="converted">Converted</option>
              <option value="notConverted">Not Converted</option>
              <option value="qualified">Qualified</option>
              <option value="rejected">Rejected</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>

            <button
              type="button"
              className="report-type-btn"
              onClick={handleExportExcel}
              disabled={filteredLeadRows.length === 0}
              style={{
                minWidth: 170,
                background: "#16a34a",
                color: "#fff",
                borderColor: "#16a34a",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <i className="bi bi-file-earmark-excel" aria-hidden="true" />
              Export Excel
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Company", "Created On", "Source", "Status", "Activity", "Temperature", "Assigned To", "Follow-Ups", "Meetings"].map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      fontSize: 12,
                      color: "#475569",
                      borderBottom: "1px solid #e2e8f0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLeadRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "18px 14px", color: "#94a3b8", textAlign: "center" }}>
                    No leads match this filter.
                  </td>
                </tr>
              ) : (
                filteredLeadRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#334155" }}>{row.companyName || "Unnamed Lead"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.sourceLabel || "Unknown"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", textTransform: "capitalize" }}>{row.status || "new"}</td>
                    <td style={{ padding: "12px 14px", color: row.isContacted ? "#0f766e" : "#b45309", fontWeight: 600 }}>
                      {row.isContacted ? "Contacted" : "Not Contacted"}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#475569", textTransform: "capitalize" }}>{row.leadTemperature || "cold"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.assignedToName || "Unassigned"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{Number(row.totalFollowups || 0)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{Number(row.meetingCount || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
