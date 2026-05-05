import React, { useEffect, useState } from "react";
import API from "../../../api";

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatPercent(value, includeSign = false) {
  const amount = Number(value || 0);
  const prefix = includeSign && amount > 0 ? "+" : "";
  return `${prefix}${amount.toFixed(1)}%`;
}

function getLeadKpiTone(value, type) {
  const amount = Number(value || 0);
  if (type === "Rejected") return "warning";
  if (type === "Converted" || type === "Qualified" || type === "Contacted") {
    return amount > 0 ? "positive" : "neutral";
  }
  // For Total Leads, New, etc., could be dynamic if comparison data is available
  return "neutral";
}

function buildLeadKpiCards(reportData, loading, error) {
  if (loading) {
    return [
      { key: "totalLeads", value: "Loading...", label: "Total Leads", meta: "Fetching live lead data", tone: "neutral" },
      { key: "converted", value: "Loading...", label: "Converted", meta: "Fetching live lead data", tone: "neutral" },
      { key: "convRate", value: "Loading...", label: "Conversion", meta: "Fetching live lead data", tone: "neutral" },
      { key: "uncontacted", value: "Loading...", label: "Uncontacted", meta: "Fetching live lead data", tone: "neutral" },
      { key: "growth", value: "Loading...", label: "Growth", meta: "Fetching live lead data", tone: "neutral" },
    ];
  }

  if (error || !reportData?.kpis) {
    return [
      { key: "totalLeads", value: "--", label: "Total Leads", meta: "Unable to load KPI data", tone: "warning" },
      { key: "converted", value: "--", label: "Converted", meta: "Unable to load KPI data", tone: "warning" },
      { key: "convRate", value: "--", label: "Conversion", meta: "Unable to load KPI data", tone: "warning" },
      { key: "uncontacted", value: "--", label: "Uncontacted", meta: "Unable to load KPI data", tone: "warning" },
      { key: "growth", value: "--", label: "Growth", meta: "Unable to load KPI data", tone: "warning" },
    ];
  }

  const { kpis } = reportData;
  const convRate = kpis.total > 0 ? (kpis.converted / kpis.total) * 100 : 0;
  const growthTone = kpis.growth > 0 ? "positive" : kpis.growth < 0 ? "negative" : "neutral";

  return [
    { key: "totalLeads", value: formatCount(kpis.total), label: "Leads", meta: "Total in period", tone: "neutral" },
    { key: "converted", value: formatCount(kpis.converted), label: "Converted", meta: "Turned to deals", tone: "positive" },
    { key: "convRate", value: formatPercent(convRate), label: "Conversion", meta: "Success rate", tone: "positive" },
    { key: "uncontacted", value: `${formatCount(kpis.uncontacted)}${kpis.uncontacted > 0 ? " ❗" : ""}`, label: "Uncontacted", meta: "Needs attention", tone: kpis.uncontacted > 0 ? "warning" : "neutral" },
    { key: "growth", value: formatPercent(kpis.growth, true), label: "Growth", meta: `vs ${reportData.comparisonLabel || "last period"}`, tone: growthTone },
  ];
}

function LeadsTab({ period = "monthly" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <div className="leads-tab">
      {/* KPI CARDS */}
      <section className="kpi-grid">
        {kpiCards.map((c) => (
          <div key={c.key} className={`kpi-card ${c.tone}`}>
            <div className="kpi-value">{c.value}</div>
            <span>{c.label}</span>
            <div className="kpi-meta">{c.meta}</div>
          </div>
        ))}
      </section>

      {/* LEADS ANALYTICS CHART */}
      <section className="reports-card">
        <h2 className="reports-card-title">Leads Analytics</h2>
        {trend.length === 0 ? (
          <div className="chart-box" style={{ color: "#9ca3af" }}>No lead data yet</div>
        ) : (
          <div style={{ width: "100%", padding: "8px 0" }}>
            {(() => {
              const W = 800;
              const H = 200;
              const pad = { top: 20, right: 20, bottom: 40, left: 50 };
              const innerW = W - pad.left - pad.right;
              const innerH = H - pad.top - pad.bottom;
              const maxVal = Math.max(...trend.map((r) => r.total), 5);
              const niceMax = Math.ceil(maxVal / 5) * 5;
              const xStep = innerW / Math.max(trend.length - 1, 1);
              const yScale = (v) => pad.top + (1 - v / niceMax) * innerH;
              const pts = trend.map((r, i) => ({ x: pad.left + i * xStep, y: yScale(r.total), ...r }));
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

              return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible" }}>
                  <defs>
                    <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.1" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0, 0.5, 1].map((t) => (
                    <line key={t} x1={pad.left} x2={W - pad.right} y1={yScale(niceMax * t)} y2={yScale(niceMax * t)} stroke="#f1f5f9" strokeWidth="1" />
                  ))}
                  <path d={`${linePath} L${pts[pts.length - 1].x},${pad.top + innerH} L${pts[0].x},${pad.top + innerH} Z`} fill="url(#leadGrad)" />
                  <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
                  {pts.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r="3" fill="#3b82f6" stroke="#fff" strokeWidth="1" />
                      {trend.length < 15 && <text x={p.x} y={H - 10} textAnchor="middle" fontSize="10" fill="#94a3b8">{p.label}</text>}
                    </g>
                  ))}
                </svg>
              );
            })()}
          </div>
        )}
      </section>

      {/* LEAD FUNNEL */}
      <section className="reports-card">
        <h2 className="reports-card-title">Conversion Analytics</h2>
        <h4 style={{ margin: "0 0 16px", fontSize: 14, color: "#475569", fontWeight: 500 }}>Lead Funnel Journey</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" }}>
          {funnel.map((step, i) => {
            const pct = Math.max(0, funnelMax > 0 ? (step.count / funnelMax) * 100 : 0);
            const colors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b"];
            return (
              <div key={step.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                    {i > 0 ? "↓ " : ""}{step.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{step.count}</span>
                </div>
                <div style={{ paddingRight: "20px" }}>
                  <div style={{ background: "#e2e8f0", borderRadius: 4, height: 10 }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        background: colors[i] || "#6366f1",
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
            { label: "Lead to Contacted", value: funnel[0]?.count ? Math.round((funnel[1]?.count / funnel[0]?.count) * 100) : 0 },
            { label: "Contacted to Qualified", value: funnel[1]?.count ? Math.round((funnel[2]?.count / funnel[1]?.count) * 100) : 0 },
            { label: "Overall Conversion", value: funnel[0]?.count ? Math.round((funnel[3]?.count / funnel[0]?.count) * 100) : 0 },
          ].map((m) => (
            <div key={m.label} style={{ flex: 1, minWidth: 120, background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#334155" }}>{m.value}%</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.025em" }}>{m.label}</div>
            </div>
          ))}
        </div>

        {kpis.total > 0 && kpis.converted !== undefined && (
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary, #64748b)" }}>
            Conversion rate:{" "}
            <strong>{((kpis.converted / kpis.total) * 100).toFixed(1)}%</strong>
          </p>
        )}
      </section>
    </div>
  );
}

export default LeadsTab;
