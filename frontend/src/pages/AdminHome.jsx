// AdminHome.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";
import {
  CCard,
  CCardBody,
  CCardHeader,
  CBadge,
  CTable,
  CTableHead,
  CTableRow,
  CTableHeaderCell,
  CTableBody,
  CTableDataCell,
  CProgress,
  CSpinner,
  CAlert,
  CFormSelect,
  CButton,
} from "@coreui/react";
import "../styles/AdminHome.css";

// ✅ Switch this to true only if you want mock data
const USE_MOCK = false;
const ADMIN_AI_INSIGHTS = [
  {
    title: "Deals needing attention",
    value: "2 high-risk accounts",
    note: "Review Greenfield Solar and Reliance Infra this week.",
  },
  {
    title: "Best win window",
    value: "P5 to P6 deals",
    note: "Proposal-stage conversations are converting fastest right now.",
  },
  {
    title: "Next action",
    value: "Schedule executive follow-up",
    note: "Shorter response gaps are helping close larger opportunities.",
  },
];

/* ---------- helpers ---------- */
function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}
function formatINR(value) {
  const num = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(num)) return "\u20B90";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 10000000) {
    const cr = abs / 10000000;
    const display = cr >= 100
      ? Math.round(cr).toLocaleString("en-IN")
      : cr.toFixed(cr >= 10 ? 1 : 2).replace(/\.?0+$/, "");
    return `${sign}\u20B9${display}Cr`;
  }

  if (abs >= 100000) {
    const lakh = abs / 100000;
    const display = lakh >= 100
      ? Math.round(lakh).toLocaleString("en-IN")
      : lakh.toFixed(lakh >= 10 ? 1 : 2).replace(/\.?0+$/, "");
    return `${sign}\u20B9${display}Lakh`;
  }

  return `${sign}${abs.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  })}`;
}

/* Custom Badge for AI labels */
function AiBadge({ children, tone = "ai" }) {
  return <span className={cx("badge", `badge--${tone}`)}>{children}</span>;
}

// risk badge
function Risk({ level }) {
  const colorMap = { low: "success", medium: "warning", high: "danger" };
  return (
    <CBadge
      color={colorMap[level] || "secondary"}
      className={cx("risk-badge", `risk--${level}`)}
      shape="rounded-pill"
    >
      {level}
    </CBadge>
  );
}

// stage
function StagePill({ stage }) {
  return (
    <CBadge color="light" className="stage-pill" shape="rounded-pill">
      {stage}
    </CBadge>
  );
}

async function apiGet(path, params = {}, signal) {
  const res = await API.get(path, { params, signal });
  return res.data;
}

/* ---------------- MOCK (range-aware) ---------------- */
function getMockDashboard(range = "month", pipelineType = "deal") {
  const mult = range === "week" ? 0.35 : range === "quarter" ? 2.4 : 1;

  const summary = {
    revenueWon: Math.round(4300000 * mult),
    revenueDeltaPct: range === "week" ? 6.2 : range === "quarter" ? 18.7 : 14.3,
    activeDeals: range === "week" ? 2 : range === "quarter" ? 9 : 4,
    activeDealsDelta: range === "week" ? 1 : range === "quarter" ? 5 : 3,
    winRatePct: range === "week" ? 28 : range === "quarter" ? 41 : 33,
    winRateDeltaPct: range === "week" ? 2 : range === "quarter" ? 7 : 5,
    pipelineValue: Math.round(16700000 * mult),
    pipelineDeltaPct:
      range === "week" ? -0.8 : range === "quarter" ? 4.1 : -2.1,
    openLeads: range === "week" ? 3 : range === "quarter" ? 11 : 5,
    openLeadsFromAI: range === "week" ? 1 : range === "quarter" ? 4 : 2,
  };

  const pipelineBase = [
    { code: "P1", label: "Prospect", count: 0, amount: 0 },
    { code: "P2", label: "Qualified", count: 0, amount: 0 },
    { code: "P3", label: "In Conversation", count: 1, amount: 7200000 },
    { code: "P4", label: "Meeting Scheduled", count: 1, amount: 4500000 },
    { code: "P5", label: "Proposal Sent", count: 1, amount: 1800000 },
    { code: "P6", label: "Negotiation", count: 1, amount: 3200000 },
    { code: "P7", label: "Closed Won", count: 0, amount: 0 },
  ];

  const dealPipeline =
    range === "week"
      ? pipelineBase.map((p) => ({
          ...p,
          count: p.code === "P4" ? 1 : p.code === "P6" ? 1 : 0,
          amount: p.code === "P4" ? 4500000 : p.code === "P6" ? 3200000 : 0,
        }))
      : range === "quarter"
      ? pipelineBase.map((p) => ({
          ...p,
          count: p.count ? p.count + 1 : 0,
          amount: p.amount ? p.amount + 900000 : 0,
        }))
      : pipelineBase;

  const leadPipeline = pipelineBase.map((p) => ({
    ...p,
    count:
      p.code === "P1" ? 6 :
      p.code === "P2" ? 4 :
      p.code === "P3" ? 3 :
      p.code === "P4" ? 2 :
      p.code === "P5" ? 1 :
      p.code === "P6" ? 1 : 0,
    amount:
      p.code === "P1" ? 1200000 :
      p.code === "P2" ? 2400000 :
      p.code === "P3" ? 3600000 :
      p.code === "P4" ? 2800000 :
      p.code === "P5" ? 1700000 :
      p.code === "P6" ? 900000 : 0,
  }));

  const pipeline = String(pipelineType || "deal").toLowerCase() === "lead"
    ? leadPipeline
    : dealPipeline.filter((p) => ["P1", "P2", "P3", "P7"].includes(p.code));

  const teamPerformance =
    range === "week"
      ? [
          { id: "u1", name: "Anil Sharma", value: 740000, pct: 68, color: "success" },
          { id: "u2", name: "Karan Singh", value: 520000, pct: 54, color: "primary" },
          { id: "u3", name: "Neha Roy", value: 410000, pct: 42, color: "info" },
        ]
      : range === "quarter"
      ? [
          { id: "u1", name: "Anil Sharma", value: 6140000, pct: 88, color: "success" },
          { id: "u2", name: "Karan Singh", value: 4890000, pct: 74, color: "primary" },
          { id: "u3", name: "Neha Roy", value: 3520000, pct: 61, color: "info" },
        ]
      : [
          { id: "u1", name: "Anil Sharma", value: 2140000, pct: 78, color: "success" },
          { id: "u2", name: "Karan Singh", value: 1890000, pct: 62, color: "primary" },
          { id: "u3", name: "Neha Roy", value: 1420000, pct: 48, color: "info" },
        ];

  const followups =
    range === "week"
      ? [
          { id: "f1", title: "TechNova - Demo call", owner: "Anil Sharma", score: 92, date: "Wed", priority: "high", icon: "📞" },
          { id: "f2", title: "Reliance - Proposal follow-up", owner: "Priya Mehta", score: 78, date: "Fri", priority: "medium", icon: "✉️" },
        ]
      : range === "quarter"
      ? [
          { id: "f1", title: "Greenfield - Negotiation review", owner: "Karan Singh", score: 90, date: "Week 2", priority: "high", icon: "🤝" },
          { id: "f2", title: "Medanta - Legal doc check", owner: "Neha Roy", score: 82, date: "Week 4", priority: "medium", icon: "📄" },
          { id: "f3", title: "TechNova - Stakeholder meeting", owner: "Anil Sharma", score: 88, date: "Week 6", priority: "high", icon: "👥" },
        ]
      : [
          { id: "f1", title: "TechNova - Product demo call", owner: "Anil Sharma", score: 92, date: "20 Mar 2025", priority: "high", icon: "📞" },
          { id: "f2", title: "Reliance - Proposal follow-up email", owner: "Priya Mehta", score: 78, date: "21 Mar 2025", priority: "medium", icon: "✉️" },
          { id: "f3", title: "Medanta - Contract signing meeting", owner: "Karan Singh", score: 95, date: "25 Mar 2025", priority: "high", icon: "🤝" },
        ];

  const recentDeals =
    range === "week"
      ? [
          { id: "d2", client: "Reliance Infra", stage: "P4", value: 4500000, risk: "medium", closeDate: "This week" },
          { id: "d4", client: "Medanta Hospitals", stage: "P6", value: 3200000, risk: "low", closeDate: "This week" },
        ]
      : range === "quarter"
      ? [
          { id: "d1", client: "TechNova Pvt Ltd", stage: "P5", value: 2800000, risk: "low", closeDate: "Apr 2025" },
          { id: "d2", client: "Reliance Infra", stage: "P4", value: 6500000, risk: "medium", closeDate: "May 2025" },
          { id: "d3", client: "Greenfield Solar", stage: "P3", value: 9200000, risk: "high", closeDate: "Jun 2025" },
          { id: "d4", client: "Medanta Hospitals", stage: "P6", value: 4200000, risk: "low", closeDate: "Apr 2025" },
          { id: "d5", client: "Apex Logistics", stage: "P2", value: 1800000, risk: "medium", closeDate: "Jun 2025" },
        ]
      : [
          { id: "d1", client: "TechNova Pvt Ltd", stage: "P5", value: 1800000, risk: "low", closeDate: "28 Mar 2025" },
          { id: "d2", client: "Reliance Infra", stage: "P4", value: 4500000, risk: "medium", closeDate: "15 Apr 2025" },
          { id: "d3", client: "Greenfield Solar", stage: "P3", value: 7200000, risk: "high", closeDate: "02 May 2025" },
          { id: "d4", client: "Medanta Hospitals", stage: "P6", value: 3200000, risk: "low", closeDate: "22 Mar 2025" },
        ];

  return { summary, pipeline, teamPerformance, followups, recentDeals };
}

/* ---------------- BACKEND ---------------- */
async function fetchDashboard(range, pipelineType, signal) {
  const [sum, pipe, team, fu, deals] = await Promise.all([
    apiGet("/api/admin/dashboard/summary", { range }, signal),
    apiGet("/api/admin/dashboard/pipeline", { range, pipelineType }, signal),
    apiGet("/api/admin/dashboard/team-performance", { range }, signal),
    apiGet("/api/admin/dashboard/followups", { range }, signal),
    apiGet("/api/admin/dashboard/recent-deals", { range }, signal),
  ]);

  return {
    summary: sum,
    pipeline: pipe,
    teamPerformance: team,
    followups: fu,
    recentDeals: deals,
  };
}

export default function AdminHome() {
  const [range, setRange] = useState("month");
  const [pipelineType, setPipelineType] = useState("deal");

  // first load skeleton
  const [loading, setLoading] = useState(true);

  // ✅ NEW: refresh overlay (prevents layout jump)
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [summary, setSummary] = useState({
    revenueWon: 0,
    revenueDeltaPct: 0,
    activeDeals: 0,
    activeDealsDelta: 0,
    winRatePct: 0,
    winRateDeltaPct: 0,
    pipelineValue: 0,
    pipelineDeltaPct: 0,
    openLeads: 0,
    openLeadsFromAI: 0,
  });

  const [pipeline, setPipeline] = useState([]);
  const [teamPerf, setTeamPerf] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [recentDeals, setRecentDeals] = useState([]);

  const navigate = useNavigate();

  const totalPipelineCount = useMemo(
    () => pipeline.reduce((acc, p) => acc + (p.count || 0), 0),
    [pipeline]
  );

  const visibleRecentDeals = useMemo(
    () => recentDeals.slice(0, 4),
    [recentDeals]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      // if already have data, do overlay refresh instead of skeleton
      const hasData =
        pipeline.length > 0 ||
        teamPerf.length > 0 ||
        followups.length > 0 ||
        recentDeals.length > 0;

      if (!hasData) setLoading(true);
      else setRefreshing(true);

      setError("");

      try {
        if (USE_MOCK) {
          const mock = getMockDashboard(range, pipelineType);
          setSummary(mock.summary);
          setPipeline(mock.pipeline);
          setTeamPerf(mock.teamPerformance);
          setFollowups(mock.followups);
          setRecentDeals(mock.recentDeals);
        } else {
          const data = await fetchDashboard(range, pipelineType, controller.signal);
          setSummary(data.summary);
          setPipeline(data.pipeline);
          setTeamPerf(data.teamPerformance);
          setFollowups(data.followups);
          setRecentDeals(data.recentDeals);
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }

    load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, pipelineType]);

  const kpis = [
    {
      title: "Revenue (Won)",
      value: formatINR(summary.revenueWon),
      sub: `${summary.revenueDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.revenueDeltaPct
      )}% vs last ${range}`,
      accent: "green",
    },
    {
      title: "Active Deals",
      value: String(summary.activeDeals),
      sub: `${summary.activeDealsDelta >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.activeDealsDelta
      )} this ${range}`,
      accent: "blue",
    },
    {
      title: "Win Rate",
      value: `${summary.winRatePct}%`,
      sub: `${summary.winRateDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.winRateDeltaPct
      )}% this ${range}`,
      accent: "cyan",
    },
    {
      title: "Pipeline Value",
      value: formatINR(summary.pipelineValue),
      sub: `${summary.pipelineDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.pipelineDeltaPct
      )}% vs target`,
      accent: "purple",
    },
    {
      title: "Open Leads",
      value: String(summary.openLeads),
      sub: `AI sourced: ${summary.openLeadsFromAI}`,
      accent: "pink",
    },
  ];

  return (
    <div className="adminHome">
      <div className="adminHome__bg" />

      {/* ✅ NEW: overlay refresh spinner (no layout jump) */}
      {refreshing && (
        <div className="refreshOverlay">
          <CSpinner color="primary" />
        </div>
      )}

      {/* Top Bar */}
      <div className="topBar">
        <div className="topActions">
          <CFormSelect
            className="select"
            value={range}
            disabled={refreshing}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
          </CFormSelect>
        </div>
      </div>

      {/* Error */}
      {error && (
        <CAlert color="danger" className="mb-3">
          <strong>Error: </strong>
          {error}
        </CAlert>
      )}

      {/* Loading Skeleton (only on first load) */}
      {loading ? (
        <div className="skeletonGrid">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="sk sk--kpi">
              <CSpinner size="sm" color="primary" className="sk-spinner" />
            </div>
          ))}
          <div className="sk sk--panel" />
          <div className="sk sk--panel" />
          <div className="sk sk--panelWide" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="kpiGrid">
            {kpis.map((c) => (
              <CCard key={c.title} className={cx("kpi", `kpi--${c.accent}`)}>
                <CCardBody>
                  <p className="kpi__title">{c.title}</p>
                  <h2 className="kpi__value">{c.value}</h2>
                  <p className="kpi__sub">{c.sub}</p>
                </CCardBody>
              </CCard>
            ))}
          </div>

          {/* Main Grid */}
          <div className="mainGrid">
            {/* Deal Pipeline */}
            <CCard className="panel panel--pipeline">
              <CCardHeader className="panel__header">
                <div className="panel__titleRow panel__titleRow--space">
                  <div className="panel__titleRow">
                    <span className="panel__title">
                      {pipelineType === "lead" ? "Lead Pipeline" : "Deal Pipeline"}
                    </span>
                    <div className="pipelineToggle">
                      <button
                        type="button"
                        className={cx("pipelineToggleBtn", pipelineType === "deal" && "active")}
                        onClick={() => setPipelineType("deal")}
                        disabled={refreshing}
                      >
                        Deal
                      </button>
                      <button
                        type="button"
                        className={cx("pipelineToggleBtn", pipelineType === "lead" && "active")}
                        onClick={() => setPipelineType("lead")}
                        disabled={refreshing}
                      >
                        Lead
                      </button>
                    </div>
                  </div>
                  <span className="panel__meta">{range.toUpperCase()}</span>
                </div>
              </CCardHeader>

              <CCardBody>
                {/* Stage chips */}
                <div className="stageStrip">
                  {pipeline.map((p, idx) => (
                    <div
                      key={p.code}
                      className={cx("stageChip", `stageChip--${idx + 1}`)}
                    >
                      <div className="stageChip__code">{p.code}</div>
                      <div className="stageChip__count">{p.count}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bars */}
                <div className="bars">
                  {pipeline.map((p) => {
                    const width =
                      totalPipelineCount === 0
                        ? 0
                        : Math.round(((p.count || 0) / totalPipelineCount) * 100);
                    const fill = Math.max(width, (p.count || 0) > 0 ? 12 : 0);

                    return (
                      <div key={p.code} className="barRow">
                        <div className="barRow__left">
                          <span className="barRow__label">{p.code}</span>
                        </div>

                        <div className="barRow__mid">
                          <CProgress
                            value={fill}
                            className="barTrack"
                            color="primary"
                            thin
                          />
                        </div>

                        <div className="barRow__right">
                          <div className="barRow__nums">
                            <span className="muted">{p.count} {pipelineType === "deal" ? "deals" : "leads"}</span>
                            <span className="muted">{formatINR(p.amount)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CCardBody>
            </CCard>

            {/* Right Column */}
            <div className="rightCol">
              {/* Team Performance */}
              <CCard className="panel">
                <CCardHeader className="panel__header">
                  <span className="panel__title">Team Performance</span>
                  <span className="panel__meta">{range.toUpperCase()}</span>
                </CCardHeader>
                <CCardBody>
                  <div className="teamList">
                    {teamPerf.map((m) => (
                      <div key={m.id} className="teamItem">
                        <div className="teamItem__name">{m.name}</div>
                        <div className="teamItem__bar">
                          <CProgress
                            value={Math.min(100, Math.max(0, m.pct))}
                            color={m.color}
                            className="miniTrack"
                            thin
                          />
                        </div>
                        <div className="teamItem__value">{formatINR(m.value)}</div>
                      </div>
                    ))}
                  </div>
                </CCardBody>
              </CCard>

              {/* Follow-ups */}
              <CCard className="panel">
                <CCardHeader className="panel__header">
                  <div className="panel__titleRow panel__titleRow--space">
                    <div className="panel__titleRow">
                      <span className="panel__title">Upcoming Follow-ups</span>
                      <AiBadge tone="priority">AI Priority</AiBadge>
                    </div>

                    <CButton
                      color="primary"
                      size="sm"
                      className="btnNeon"
                      onClick={() => navigate(`/followups`)}
                    >
                      View All
                    </CButton>
                  </div>
                </CCardHeader>

                <CCardBody>
                  <div className="followList">
                    {followups.slice(0, 2).map((f) => (
                      <div key={f.id} className="followItem">
                        <div className="followIcon">{f.icon}</div>

                        <div className="followBody">
                          <div className="followTitle">{f.companyName || f.title}</div>
                          <div className="followMeta">
                            <span className="muted">{f.itemType || "Follow-up"}</span>
                            <span className="dot" />
                            <span className="muted">{f.title}</span>
                            <span className="dot" />
                            <span className="muted">Score: {f.score}</span>
                          </div>
                        </div>

                        <div className="followRight">
                          <div className="muted">{f.date}</div>
                          <CBadge
                            color={
                              f.priority === "high"
                                ? "danger"
                                : f.priority === "medium"
                                ? "primary"
                                : "success"
                            }
                            shape="rounded-pill"
                            className={cx("prio", `prio--${f.priority}`)}
                          >
                            {f.priority}
                          </CBadge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CCardBody>
              </CCard>
            </div>

            <div className="dealsInsightsGrid">
              {/* Recent Deals Table */}
              <CCard className="panel panel--deals">
                <CCardHeader className="panel__header">
                  <div className="panel__titleRow panel__titleRow--space">
                    <span className="panel__title">Recent Deals</span>

                    <CButton
                      color="primary"
                      size="sm"
                      className="btnNeon"
                      onClick={() => navigate(`/deals`)}
                    >
                      View All
                    </CButton>
                  </div>
                </CCardHeader>

                <CCardBody className="p-0">
                  <CTable hover responsive className="tbl mb-0">
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell>Client</CTableHeaderCell>
                        <CTableHeaderCell>Stage</CTableHeaderCell>
                        <CTableHeaderCell>Value</CTableHeaderCell>
                        <CTableHeaderCell>Risk</CTableHeaderCell>
                        <CTableHeaderCell>Close Date</CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>

                    <CTableBody>
                      {visibleRecentDeals.map((d) => (
                        <CTableRow key={d.id}>
                          <CTableDataCell className="tbl__client">
                            {d.client}
                          </CTableDataCell>
                          <CTableDataCell>
                            <StagePill stage={d.stage} />
                          </CTableDataCell>
                          <CTableDataCell className="tbl__value">
                            {formatINR(d.value)}
                          </CTableDataCell>
                          <CTableDataCell>
                            <Risk level={d.risk} />
                          </CTableDataCell>
                          <CTableDataCell className="muted">
                            {d.closeDate}
                          </CTableDataCell>
                        </CTableRow>
                      ))}
                    </CTableBody>
                  </CTable>
                </CCardBody>
              </CCard>

              <CCard className="panel panel--aiInsights">
                <CCardHeader className="panel__header">
                  <div className="panel__titleRow">
                    <span className="panel__title">AI Insights</span>
                    <AiBadge tone="priority">Static</AiBadge>
                  </div>
                </CCardHeader>

                <CCardBody>
                  <div className="aiInsightsList">
                    {ADMIN_AI_INSIGHTS.map((item) => (
                      <div key={item.title} className="aiInsightItem">
                        <span className="aiInsightItem__label">{item.title}</span>
                        <strong className="aiInsightItem__value">{item.value}</strong>
                        <p className="aiInsightItem__note">{item.note}</p>
                      </div>
                    ))}
                  </div>
                </CCardBody>
              </CCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

