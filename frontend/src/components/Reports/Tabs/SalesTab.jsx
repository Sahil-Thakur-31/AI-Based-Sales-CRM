import React, { useEffect, useState } from "react";
import API from "../../../api";

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value, includeSign = false) {
  const amount = Number(value || 0);
  const prefix = includeSign && amount > 0 ? "+" : "";
  return `${prefix}${amount.toFixed(1)}%`;
}

function formatDays(value) {
  const amount = Number(value || 0);
  return `${amount.toFixed(1)} Days`;
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

function escapeCsvValue(value) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function matchesSalesTableFilter(row, filterValue) {
  switch (filterValue) {
    case "open":
    case "won":
    case "lost":
      return String(row.status || "").toLowerCase() === filterValue;
    case "p1":
    case "p2":
    case "p3":
    case "p7":
      return String(row.stage || "").toLowerCase() === filterValue;
    default:
      return true;
  }
}

function normalizeSearchValue(value) {
  return String(value ?? "").toLowerCase().trim();
}

function matchesSalesSearch(row, searchValue) {
  const query = normalizeSearchValue(searchValue);
  if (!query) return true;

  const haystack = [
    row.dealName,
    row.companyName,
    row.status,
    row.stage,
    row.assignedToName,
    row.dealValue,
    formatDate(row.createdAt),
    formatDate(row.closedAt),
  ]
    .map(normalizeSearchValue)
    .join(" ");

  return haystack.includes(query);
}

function getTrendClass(value) {
  const amount = Number(value || 0);
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

function getCycleMeta(salesCycle = {}, comparisonLabel = "previous period") {
  const currentSamples = Number(salesCycle.sampleSize || 0);
  const previousValue = Number(salesCycle.previousValue || 0);
  const currentValue = Number(salesCycle.value || 0);

  if (!currentSamples) {
    return "No won deals in this period yet";
  }

  if (!previousValue) {
    return `${currentSamples} won deal${currentSamples === 1 ? "" : "s"} measured`;
  }

  const diff = Math.abs(currentValue - previousValue).toFixed(1);
  const direction = currentValue <= previousValue ? "faster" : "slower";
  return `${diff} days ${direction} than ${comparisonLabel}`;
}

function buildKpiCards(reportData, loading, error) {
  if (loading) {
    return [
      { key: "revenue", value: "Loading...", label: "Revenue", meta: "Fetching live sales data", tone: "neutral" },
      { key: "winRate", value: "Loading...", label: "Win Rate", meta: "Fetching live sales data", tone: "neutral" },
      { key: "avgDeal", value: "Loading...", label: "Avg Deal", meta: "Fetching live sales data", tone: "neutral" },
      { key: "salesCycle", value: "Loading...", label: "Sales Cycle", meta: "Fetching live sales data", tone: "neutral" },
      { key: "growth", value: "Loading...", label: "Growth", meta: "Fetching live sales data", tone: "neutral" },
    ];
  }

  if (error || !reportData?.kpis) {
    return [
      { key: "revenue", value: "--", label: "Revenue", meta: "Unable to load live KPI data", tone: "warning" },
      { key: "winRate", value: "--", label: "Win Rate", meta: "Unable to load live KPI data", tone: "warning" },
      { key: "avgDeal", value: "--", label: "Avg Deal", meta: "Unable to load live KPI data", tone: "warning" },
      { key: "salesCycle", value: "--", label: "Sales Cycle", meta: "Unable to load live KPI data", tone: "warning" },
      { key: "growth", value: "--", label: "Growth", meta: "Unable to load live KPI data", tone: "warning" },
    ];
  }

  const { kpis, comparisonLabel } = reportData;
  const wonDeals = Number(kpis.winRate?.wonDeals || 0);
  const closedDeals = Number(kpis.winRate?.closedDeals || 0);
  const avgDealWonCount = Number(kpis.avgDealSize?.wonDeals || 0);

  return [
    {
      key: "revenue",
      value: formatCurrency(kpis.revenue?.value),
      label: "Revenue",
      meta: `${formatPercent(kpis.revenue?.growthPct, true)} vs ${comparisonLabel}`,
      tone: "neutral",
    },
    {
      key: "winRate",
      value: formatPercent(kpis.winRate?.value),
      label: "Win Rate",
      meta: `${wonDeals} won of ${closedDeals} closed deals`,
      tone: "neutral",
    },
    {
      key: "avgDeal",
      value: formatCurrency(kpis.avgDealSize?.value),
      label: "Avg Deal",
      meta: `${avgDealWonCount} won deal${avgDealWonCount === 1 ? "" : "s"} in this period`,
      tone: "neutral",
    },
    {
      key: "salesCycle",
      value: formatDays(kpis.salesCycle?.value),
      label: "Sales Cycle",
      meta: getCycleMeta(kpis.salesCycle, comparisonLabel),
      tone: "neutral",
    },
    {
      key: "growth",
      value: formatPercent(kpis.growth?.value, true),
      label: "Growth",
      meta: `Revenue vs ${comparisonLabel}`,
      tone: getTrendClass(kpis.growth?.value),
    },
  ];
}

function buildSalesReportParams(filters = {}) {
  const period = filters.period || "monthly";
  const params = {
    period,
    year: filters.year || String(new Date().getFullYear()),
  };

  if (period === "monthly") {
    params.month = filters.month || String(new Date().getMonth() + 1);
  }

  if (period === "quarterly") {
    params.quarter = filters.quarter || "q1";
  }

  if (filters.assignedTo && filters.assignedTo !== "all") {
    params.assignedTo = filters.assignedTo;
  }

  return params;
}

function SalesTab({ filters, selectedUser }) {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [salesTableFilter, setSalesTableFilter] = useState("all");
  const [salesSearch, setSalesSearch] = useState("");
  const [analytics, setAnalytics] = useState({
    revenueTrend: [],
    revenueByUser: [],
    performanceByUser: [],
    dealSizeBuckets: [],
    targetSummary: null,
    tableRows: [],
  });

  useEffect(() => {
    let isMounted = true;
    const params = buildSalesReportParams(filters);

    async function fetchAll() {
      setLoading(true);
      setError("");
      try {
        const [kpisRes, analyticsRes] = await Promise.allSettled([
          API.get("/deals/reports/kpis", { params }),
          API.get("/deals/reports/analytics", { params }),
        ]);
        if (!isMounted) return;
        if (kpisRes.status === "fulfilled") {
          setReportData(kpisRes.value.data || null);
        } else {
          setError(kpisRes.reason?.response?.data?.message || "Failed to load KPIs");
        }
        if (analyticsRes.status === "fulfilled") {
          setAnalytics(
            analyticsRes.value.data || {
              revenueTrend: [],
              revenueByUser: [],
              performanceByUser: [],
              dealSizeBuckets: [],
              targetSummary: null,
              tableRows: [],
            }
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchAll();
    return () => {
      isMounted = false;
    };
  }, [filters.assignedTo, filters.month, filters.period, filters.quarter, filters.year]);

  const kpiCards = buildKpiCards(reportData, loading, error);
  const viewerRoleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const selectedRoleName = String(selectedUser?.roleName || "").trim().toLowerCase();
  const isAllUsersView = !filters.assignedTo || filters.assignedTo === "all";
  const isSingleUserView = !isAllUsersView;
  const showSelectedManagerTeamPerformance =
    viewerRoleName === "admin" &&
    !isAllUsersView &&
    selectedRoleName === "manager";
  const showIndividualTargetProgress = isSingleUserView && selectedRoleName !== "manager";
  const salesTableRows = analytics.tableRows || [];
  const filteredSalesTableRows = salesTableRows.filter(
    (row) => matchesSalesTableFilter(row, salesTableFilter) && matchesSalesSearch(row, salesSearch)
  );

  function handleSalesExportExcel() {
    const headers = [
      "Deal Name",
      "Company",
      "Created On",
      "Closed On",
      "Deal Value",
      "Status",
      "Stage",
      "Assigned To",
    ];

    const csvRows = filteredSalesTableRows.map((row) => [
      row.dealName || "Unnamed Deal",
      row.companyName || "Unknown Company",
      formatDate(row.createdAt),
      formatDate(row.closedAt),
      formatCurrency(row.dealValue),
      row.status || "open",
      row.stage || "--",
      row.assignedToName || "Unassigned",
    ]);

    const csvContent = [
      headers.map(escapeCsvValue).join(","),
      ...csvRows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-report-${filters.period || "monthly"}-${salesTableFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="sales-tab">
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
        <h2 className="reports-card-title">Revenue Analytics</h2>

        {analytics.revenueTrend.length === 0 ? (
          <div className="chart-box" style={{ color: "#9ca3af" }}>No won deal data yet</div>
        ) : (
          <div style={{ width: "100%", padding: "8px 0" }}>
            {(() => {
              const data = analytics.revenueTrend;
              const W = 800;
              const H = 240;
              const pad = { top: 24, right: 24, bottom: 44, left: 72 };
              const innerW = W - pad.left - pad.right;
              const innerH = H - pad.top - pad.bottom;
              const maxVal = Math.max(...data.map((r) => r.total), 1);
              const niceMax = Math.ceil(maxVal / 100000) * 100000 || 100000;
              const xStep = innerW / Math.max(data.length - 1, 1);
              const yScale = (v) => pad.top + (1 - v / niceMax) * innerH;
              const pts = data.map((r, i) => ({ x: pad.left + i * xStep, y: yScale(r.total), ...r }));
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
              const areaPath = `M${pts[0].x},${pad.top + innerH} ${linePath.slice(1)} L${pts[pts.length - 1].x},${pad.top + innerH} Z`;
              const ticks = [0, 0.25, 0.5, 0.75, 1];

              return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  {ticks.map((t) => {
                    const y = yScale(niceMax * t);
                    return (
                      <g key={t}>
                        <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#f0f0f5" strokeWidth="1" />
                        <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af">
                          {t === 0 ? "Rs0" : `Rs${(niceMax * t / 100000).toFixed(0)}L`}
                        </text>
                      </g>
                    );
                  })}
                  <path d={areaPath} fill="url(#areaGrad)" />
                  <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r="5" fill="#6366f1" stroke="#fff" strokeWidth="2.5" />
                      <text x={p.x} y={H - 6} textAnchor="middle" fontSize="11" fill="#6b7280">{p.label}</text>
                      <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="10" fill="#374151" fontWeight="600">
                        {`Rs${(p.total / 100000).toFixed(1)}L`}
                      </text>
                    </g>
                  ))}
                </svg>
              );
            })()}
          </div>
        )}

        {isAllUsersView && (
          <>
            <h4 style={{ margin: "16px 0 10px", color: "#374151" }}>Top Performers</h4>
            {(analytics.performanceByUser || []).length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>No data</p>
            ) : (() => {
              const top3 = analytics.performanceByUser.slice(0, 3);
              const maxRev = Math.max(...top3.map((r) => r.revenue), 1);
              return (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {top3.map((u, i) => (
                    <div key={i} style={{ flex: "1 1 180px", background: i === 0 ? "#f8f9ff" : "#fafafa", border: `1px solid ${i === 0 ? "#e0e7ff" : "#e5e7eb"}`, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, marginRight: 6 }}>#{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{u.name}</span>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#6366f1", marginBottom: 6 }}>{formatCurrency(u.revenue)}</div>
                      <div style={{ background: "#e5e7eb", borderRadius: 4, height: 6, marginBottom: 8 }}>
                        <div style={{ width: `${(u.revenue / maxRev) * 100}%`, background: "#6366f1", borderRadius: 4, height: "100%" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280" }}>
                        <span>{u.wonDeals}/{u.totalDeals} deals</span>
                        <span style={{ fontWeight: 600, color: u.winRate >= 60 ? "#10b981" : u.winRate >= 30 ? "#f59e0b" : "#ef4444" }}>{Math.min(100, u.winRate)}% WR</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {showIndividualTargetProgress && (
          <>
            <h4 style={{ margin: "16px 0 10px", color: "#374151" }}>Assigned Target Progress</h4>
            <div style={{ border: "1px solid #e0e7ff", background: "#f8f9ff", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Assigned Target</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{formatCurrency(analytics.targetSummary?.revenueTarget)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Completed Revenue</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#6366f1" }}>{formatCurrency(analytics.targetSummary?.completedValue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Won Deals</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>{Number(analytics.targetSummary?.achievedDeals || 0)}</div>
                </div>
              </div>
              <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280" }}>
                <span>Target completion</span>
                <span>{Number(analytics.targetSummary?.progressPercent || 0)}%</span>
              </div>
              <div style={{ background: "#dbe4ff", borderRadius: 999, height: 10, overflow: "hidden", marginBottom: 10 }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(analytics.targetSummary?.progressPercent || 0)))}%`,
                    background: "linear-gradient(90deg, #6366f1, #4f46e5)",
                    height: "100%",
                    borderRadius: 999,
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Completed value uses the same won-deal revenue basis as the KPI cards for the filtered period.
              </div>
            </div>
          </>
        )}
      </section>

      <section className="reports-card">
        <h2 className="reports-card-title">Lead Cohort Conversion</h2>

        {(() => {
          const cv = analytics.conversion || {};
          const funnel = [
            { label: "New Leads", count: cv.leadCount || 0 },
            { label: "Converted", count: cv.dealCount || 0 },
            { label: "Won", count: cv.wonCount || 0 },
          ];
          const maxCount = Math.max(...funnel.map((f) => f.count), 1);
          return (
            <>
              <div style={{ margin: "12px 0 20px" }}>
                {funnel.map((f, i) => (
                  <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 60, fontSize: 12, color: "#6b7280", textAlign: "right" }}>{f.label}</div>
                    <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 6, height: 32, position: "relative" }}>
                      <div style={{ width: `${(f.count / maxCount) * 100}%`, background: i === 0 ? "#818cf8" : i === 1 ? "#6366f1" : "#4f46e5", borderRadius: 6, height: "100%", transition: "width 0.4s" }} />
                    </div>
                    <div style={{ width: 40, fontSize: 13, fontWeight: 600, color: "#374151" }}>{f.count}</div>
                    {i < funnel.length - 1 && (
                      <div style={{ position: "absolute", left: 72, marginTop: 32, fontSize: 16, color: "#9ca3af" }}>v</div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                {[
                  { label: "Lead to Deal", value: Math.min(100, cv.leadToDeal || 0) },
                  { label: "Converted to Won", value: Math.min(100, cv.dealToWon || 0) },
                  { label: "Overall Cohort Win", value: Math.min(100, cv.overall || 0) },
                ].map((m) => (
                  <div key={m.label} style={{ flex: 1, minWidth: 120, background: "#f8f9ff", border: "1px solid #e0e7ff", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#6366f1" }}>{m.value}%</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                This section tracks leads created in the selected period, then measures how many of that same lead cohort converted into deals and how many of those converted deals are now won.
              </div>
            </>
          );
        })()}
      </section>

      {(isAllUsersView || showSelectedManagerTeamPerformance) && (
        <section className="reports-card">
          <h2 className="reports-card-title">Team Performance</h2>

          
          {(() => {
            if ((analytics.performanceByUser || []).length === 0) return null;
            const teamTotals = analytics.performanceByUser.reduce(
              (acc, u) => {
                acc.targetRevenue += u.targetRevenue || 0;
                acc.completedRevenue += u.revenue || 0;
                acc.targetDeals += u.targetDeals || 0;
                acc.completedDeals += u.wonDeals || 0;
                return acc;
              },
              { targetRevenue: 0, completedRevenue: 0, targetDeals: 0, completedDeals: 0 }
            );

            const displayTargetRevenue = analytics.teamTarget ? analytics.teamTarget.revenueTarget : teamTotals.targetRevenue;
            const displayTargetDeals = analytics.teamTarget ? analytics.teamTarget.dealTarget : teamTotals.targetDeals;

            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8, fontWeight: 500 }}>Team Target Revenue</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{formatCurrency(displayTargetRevenue)}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderBottom: "4px solid #10b981" }}>
                  <div style={{ fontSize: 13, color: "#166534", marginBottom: 8, fontWeight: 500 }}>Total Completed Revenue</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#10b981" }}>{formatCurrency(teamTotals.completedRevenue)}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8, fontWeight: 500 }}>Team Target Deals</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{displayTargetDeals}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderBottom: "4px solid #10b981" }}>
                  <div style={{ fontSize: 13, color: "#166534", marginBottom: 8, fontWeight: 500 }}>Total Completed Deals</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#10b981" }}>{teamTotals.completedDeals}</div>
                </div>
              </div>
            );
          })()}

          {(analytics.performanceByUser || []).length === 0 ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>No data for this period</p>
          ) : (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
              <table className="crm-auto-responsive-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Name", "Target Rev", "Completed Rev", "Target Deals", "Completed Deals", "Win Rate"].map((h) => (
                      <th key={h} style={{ padding: "9px 14px", textAlign: h === "Name" ? "left" : "center", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.performanceByUser.map((u, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "9px 14px", fontWeight: 500, color: "#111827" }}>{u.name}</td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#6b7280" }}>{formatCurrency(u.targetRevenue)}</td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#374151", fontWeight: 600 }}>{formatCurrency(u.revenue)}</td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#6b7280" }}>{u.targetDeals}</td>
                      <td style={{ padding: "9px 14px", textAlign: "center", color: "#6b7280" }}>{u.wonDeals}</td>
                      <td style={{ padding: "9px 14px", textAlign: "center" }}>
                        <span style={{ fontWeight: 700, color: u.winRate >= 60 ? "#10b981" : u.winRate >= 30 ? "#f59e0b" : "#ef4444" }}>
                          {Math.min(100, u.winRate)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="reports-card">
        <h2 className="reports-card-title">Deal Analytics</h2>
        <h4 style={{ marginBottom: 10, fontSize: 14, color: "#374151" }}>Deal Size Distribution</h4>
        {(analytics.dealSizeBuckets || []).length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: 13 }}>No data</p>
        ) : (() => {
          const maxC = Math.max(...analytics.dealSizeBuckets.map((b) => b.count), 1);
          return analytics.dealSizeBuckets.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ minWidth: 130, fontSize: 13, color: "#374151" }}>{b.label}</span>
              <div style={{ flex: 1, background: "#e5e7eb", borderRadius: 4, height: 12 }}>
                <div style={{ width: `${(b.count / maxC) * 100}%`, background: "#6366f1", borderRadius: 4, height: "100%" }} />
              </div>
              <span style={{ minWidth: 30, fontSize: 13, fontWeight: 600, color: "#374151", textAlign: "right" }}>{b.count}</span>
            </div>
          ));
        })()}
      </section>

      <section className="reports-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="reports-card-title" style={{ marginBottom: 4 }}>Sales Table</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              {filteredSalesTableRows.length} of {salesTableRows.length} deals in this period
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              className="report-filter report-search-input"
              type="text"
              placeholder="Search deals..."
              value={salesSearch}
              onChange={(event) => setSalesSearch(event.target.value)}
            />
            <select
              className="report-filter"
              value={salesTableFilter}
              onChange={(event) => setSalesTableFilter(event.target.value)}
            >
              <option value="all">All Deals</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
              <option value="p3">P3</option>
              <option value="p7">P7</option>
            </select>

            <button
              type="button"
              className="report-type-btn"
              onClick={handleSalesExportExcel}
              disabled={filteredSalesTableRows.length === 0}
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
          <table className="crm-auto-responsive-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Deal Name", "Company", "Created On", "Closed On", "Deal Value", "Status", "Stage", "Assigned To"].map((header) => (
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
              {filteredSalesTableRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "18px 14px", color: "#94a3b8", textAlign: "center" }}>
                    No deals match this search or filter.
                  </td>
                </tr>
              ) : (
                filteredSalesTableRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#334155" }}>{row.dealName || "Unnamed Deal"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.companyName || "Unknown Company"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", whiteSpace: "nowrap" }}>{formatDate(row.closedAt)}</td>
                    <td style={{ padding: "12px 14px", color: "#334155", fontWeight: 600 }}>{formatCurrency(row.dealValue)}</td>
                    <td style={{ padding: "12px 14px", color: row.status === "won" ? "#15803d" : row.status === "lost" ? "#b91c1c" : "#475569", fontWeight: 600, textTransform: "capitalize" }}>
                      {row.status || "open"}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.stage || "--"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.assignedToName || "Unassigned"}</td>
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

export default SalesTab;
