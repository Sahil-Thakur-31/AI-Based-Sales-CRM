import React, { useEffect, useState } from "react";
import API from "../../../api";

function LeadsTab({ period = "monthly" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    API.get("/leads/reports/analytics", { params: { period } })
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <div className="reports-loading">Loading...</div>;
  if (!data) return <div className="reports-loading">Failed to load data.</div>;

  const { kpis, funnel } = data;
  const funnelMax = funnel[0]?.count || 1;

  const kpiCards = [
    { label: "Total Leads", value: kpis.total, cls: "" },
    { label: "New", value: kpis.new, cls: "" },
    { label: "Contacted", value: kpis.contacted, cls: "positive" },
    { label: "Qualified", value: kpis.qualified, cls: "positive" },
    { label: "Converted", value: kpis.converted, cls: "positive" },
    { label: "Rejected", value: kpis.rejected, cls: "warning" },
  ];

  return (
    <div className="leads-tab">

      {/* KPI CARDS */}
      <section className="kpi-grid">
        {kpiCards.map((c) => (
          <div key={c.label} className={`kpi-card ${c.cls}`}>
            {c.value} <span>{c.label}</span>
          </div>
        ))}
      </section>

      {/* LEAD FUNNEL */}
      <section className="reports-card">
        <h2 className="reports-card-title">Lead Funnel</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "8px 0" }}>
          {funnel.map((step, i) => {
            const pct = funnelMax > 0 ? (step.count / funnelMax) * 100 : 0;
            const colors = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b"];
            return (
              <div key={step.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary, #64748b)" }}>
                    {i > 0 ? "↓ " : ""}{step.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{step.count}</span>
                </div>
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
            );
          })}
        </div>
        {kpis.total > 0 && (
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
