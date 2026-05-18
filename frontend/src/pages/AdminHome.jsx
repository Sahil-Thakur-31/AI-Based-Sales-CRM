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
  CButton,
} from "@coreui/react";
import Pagination from "../components/Pagination";
import DashboardDateFilter from "../components/DashboardDateFilter";
import "../styles/AdminHome.css";

// ✅ Switch this to true only if you want mock data
const USE_MOCK = false;
const ADMIN_INSIGHTS_REFRESH_MS = 60000;
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

function formatLiveTime(value) {
  if (!value) return "Just now";
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function StagePill({ stage }) {
  return (
    <CBadge color="light" className="stage-pill" shape="rounded-pill">
      {stage}
    </CBadge>
  );
}

function buildAdminAiInsights(summary, pipeline, teamPerf, followups, recentDeals, range) {
  const highRiskDeals = (recentDeals || []).filter(
    (deal) => String(deal?.risk || "").toLowerCase() === "high"
  );
  const topStage = [...(pipeline || [])].sort(
    (a, b) => Number(b?.amount || 0) - Number(a?.amount || 0) || Number(b?.count || 0) - Number(a?.count || 0)
  )[0];
  const topTeam = [...(teamPerf || [])].sort((a, b) => Number(b?.value || 0) - Number(a?.value || 0))[0];
  const priorityFollowups = (followups || []).filter((item) =>
    ["high", "urgent"].includes(String(item?.priority || "").toLowerCase())
  );

  const insights = [];

  if (highRiskDeals.length) {
    insights.push({
      title: "Deals needing attention",
      value: `${highRiskDeals.length} high-risk account${highRiskDeals.length === 1 ? "" : "s"}`,
      note: `Review ${highRiskDeals.slice(0, 2).map((deal) => deal.client).filter(Boolean).join(" and ") || "priority opportunities"} in this ${range}.`,
    });
  }

  if (topStage?.label && Number(topStage?.amount || 0) > 0) {
    insights.push({
      title: "Largest pipeline pocket",
      value: `${topStage.label} stage`,
      note: `${formatINR(topStage.amount)} is concentrated here across ${topStage.count || 0} deal(s).`,
    });
  }

  if (priorityFollowups.length) {
    insights.push({
      title: "Next action",
      value: `${priorityFollowups.length} priority follow-up${priorityFollowups.length === 1 ? "" : "s"}`,
      note: "Executive help on blocked follow-ups can protect close momentum this cycle.",
    });
  }

  if (topTeam?.name && Number(topTeam?.value || 0) > 0) {
    insights.push({
      title: "Top team benchmark",
      value: topTeam.name,
      note: `${formatINR(topTeam.value)} in won revenue makes this the strongest coaching benchmark right now.`,
    });
  }

  if (Number(summary?.openLeadsFromAI || 0) > 0) {
    insights.push({
      title: "AI lead contribution",
      value: `${summary.openLeadsFromAI} AI-sourced leads`,
      note: "Monitor whether sourced leads are converting into qualified conversations fast enough.",
    });
  }

  if (!insights.length) {
    insights.push({
      title: "Portfolio status",
      value: "Activity is steady",
      note: "No major alert is visible yet. Keep watching pipeline flow, team execution, and conversion quality.",
    });
  }

  return insights.slice(0, 3);
}

const DASHBOARD_PERIOD_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" }
];

const QUARTER_LABELS = {
  q1: "Q1 (Jan-Mar)",
  q2: "Q2 (Apr-Jun)",
  q3: "Q3 (Jul-Sep)",
  q4: "Q4 (Oct-Dec)"
};

function mapPeriodToRange(period) {
  if (period === "quarterly") return "quarter";
  if (period === "yearly") return "year";
  return "month";
}

function getMonthYearLabel(month, year) {
  const normalizedYear = Number.parseInt(year, 10);
  const safeYear = Number.isFinite(normalizedYear) ? normalizedYear : new Date().getFullYear();
  return new Date(safeYear, month, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function getQuarterYearLabel(quarter, year) {
  return `${QUARTER_LABELS[quarter] || QUARTER_LABELS.q1} ${year}`;
}

function getPeriodLabel(period, month, quarter, year) {
  if (period === "quarterly") return getQuarterYearLabel(quarter, year);
  if (period === "yearly") return String(year);
  return getMonthYearLabel(month, year);
}

function getPreviousMonthYearLabel(month, year) {
  const normalizedYear = Number.parseInt(year, 10);
  const safeYear = Number.isFinite(normalizedYear) ? normalizedYear : new Date().getFullYear();
  return new Date(safeYear, month - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function getPreviousQuarterLabel(quarter, year) {
  const normalizedYear = Number.parseInt(year, 10);
  const safeYear = Number.isFinite(normalizedYear) ? normalizedYear : new Date().getFullYear();
  const quarterOrder = ["q1", "q2", "q3", "q4"];
  const currentIndex = Math.max(0, quarterOrder.indexOf(quarter));
  const previousIndex = currentIndex === 0 ? 3 : currentIndex - 1;
  const previousYear = currentIndex === 0 ? safeYear - 1 : safeYear;
  return getQuarterYearLabel(quarterOrder[previousIndex], previousYear);
}

function getPreviousPeriodLabel(period, month, quarter, year) {
  if (period === "quarterly") return getPreviousQuarterLabel(quarter, year);
  if (period === "yearly") return String(Number.parseInt(year, 10) - 1 || new Date().getFullYear() - 1);
  return getPreviousMonthYearLabel(month, year);
}

function formatComparisonAmount(value) {
  return formatINR(Math.abs(value));
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
    revenuePreviousValue: Math.round(3760000 * mult),
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
          { id: "d2", dealName: "Reliance Infra Renewal", stage: "P4", value: 4500000, closeDate: "This week" },
          { id: "d4", dealName: "Medanta Expansion", stage: "P6", value: 3200000, closeDate: "This week" },
        ]
      : range === "quarter"
      ? [
          { id: "d1", dealName: "TechNova Platform Rollout", stage: "P5", value: 2800000, closeDate: "Apr 2025" },
          { id: "d2", dealName: "Reliance Infra Renewal", stage: "P4", value: 6500000, closeDate: "May 2025" },
          { id: "d3", dealName: "Greenfield Solar Procurement", stage: "P3", value: 9200000, closeDate: "Jun 2025" },
          { id: "d4", dealName: "Medanta Expansion", stage: "P6", value: 4200000, closeDate: "Apr 2025" },
          { id: "d5", dealName: "Apex Logistics Upgrade", stage: "P2", value: 1800000, closeDate: "Jun 2025" },
        ]
      : [
          { id: "d1", dealName: "TechNova Platform Rollout", stage: "P5", value: 1800000, closeDate: "28 Mar 2025" },
          { id: "d2", dealName: "Reliance Infra Renewal", stage: "P4", value: 4500000, closeDate: "15 Apr 2025" },
          { id: "d3", dealName: "Greenfield Solar Procurement", stage: "P3", value: 7200000, closeDate: "02 May 2025" },
          { id: "d4", dealName: "Medanta Expansion", stage: "P6", value: 3200000, closeDate: "22 Mar 2025" },
        ];

  return { summary, pipeline, teamPerformance, followups, recentDeals };
}

/* ---------------- BACKEND ---------------- */
async function fetchDashboard(range, pipelineType, filters, signal) {
  const [sum, pipe, team, fu, deals] = await Promise.all([
    apiGet("/api/admin/dashboard/summary", { range, ...filters }, signal),
    apiGet("/api/admin/dashboard/pipeline", { range, pipelineType, ...filters }, signal),
    apiGet("/api/admin/dashboard/team-performance", { range, ...filters }, signal),
    apiGet("/api/admin/dashboard/followups", { range, ...filters }, signal),
    apiGet("/api/admin/dashboard/recent-deals", { range, ...filters }, signal),
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
  const DEALS_PER_PAGE = 4;
  const FOLLOWUPS_PER_PAGE = 5;
  const today = new Date();

  useEffect(() => {
    document.body.classList.add("dashboard-scroll-hidden");
    return () => document.body.classList.remove("dashboard-scroll-hidden");
  }, []);

  const [period, setPeriod] = useState("monthly");
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState(`q${Math.floor(today.getMonth() / 3) + 1}`);
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [pipelineType, setPipelineType] = useState("deal");
  const [recentDealsPage, setRecentDealsPage] = useState(1);
  const [followupsPage, setFollowupsPage] = useState(1);

  // first load skeleton
  const [loading, setLoading] = useState(true);

  // ✅ NEW: refresh overlay (prevents layout jump)
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [summary, setSummary] = useState({
    revenueWon: 0,
    revenuePreviousValue: 0,
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
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState(new Date());

  const navigate = useNavigate();
  const range = mapPeriodToRange(period);
  const rangeLabel = getPeriodLabel(period, selectedMonth, selectedQuarter, selectedYear);
  const previousPeriodLabel = getPreviousPeriodLabel(period, selectedMonth, selectedQuarter, selectedYear);
  const revenueDifference = Number(summary.revenueWon || 0) - Number(summary.revenuePreviousValue || 0);
  const revenueWonSub = true
    ? `${formatComparisonAmount(revenueDifference)} ${revenueDifference >= 0 ? "greater" : "less"} than ${previousPeriodLabel}`
    : `${summary.revenueDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(summary.revenueDeltaPct)}% vs previous ${rangeLabel.toLowerCase()}`;
  const dashboardFilters = useMemo(
    () => ({
      period,
      month: selectedMonth + 1,
      quarter: selectedQuarter,
      year: selectedYear,
    }),
    [period, selectedMonth, selectedQuarter, selectedYear]
  );

  const totalPipelineCount = useMemo(
    () => pipeline.reduce((acc, p) => acc + (p.count || 0), 0),
    [pipeline]
  );

  const totalRecentDealsPages = useMemo(
    () => Math.max(1, Math.ceil(recentDeals.length / DEALS_PER_PAGE)),
    [recentDeals.length]
  );
  const adminAiInsights = useMemo(
    () => buildAdminAiInsights(summary, pipeline, teamPerf, followups, recentDeals, range),
    [followups, pipeline, range, recentDeals, summary, teamPerf]
  );
  const adminAiSummary = useMemo(() => {
    const first = adminAiInsights[0];
    if (!first) return "AI is watching your live CRM data for pipeline risk, follow-up pressure, and team momentum.";
    return `${first.value}: ${first.note}`;
  }, [adminAiInsights]);

  const totalFollowupsPages = useMemo(
    () => Math.max(1, Math.ceil(followups.length / FOLLOWUPS_PER_PAGE)),
    [followups.length]
  );

  const visibleRecentDeals = useMemo(
    () =>
      recentDeals.slice(
        (recentDealsPage - 1) * DEALS_PER_PAGE,
        recentDealsPage * DEALS_PER_PAGE
      ),
    [recentDeals, recentDealsPage]
  );

  const visibleFollowups = useMemo(
    () =>
      followups.slice(
        (followupsPage - 1) * FOLLOWUPS_PER_PAGE,
        followupsPage * FOLLOWUPS_PER_PAGE
      ),
    [followups, followupsPage]
  );

  useEffect(() => {
    setRecentDealsPage(1);
    setFollowupsPage(1);
  }, [period, pipelineType, selectedMonth, selectedQuarter, selectedYear]);

  useEffect(() => {
    setRecentDealsPage((current) => Math.min(current, totalRecentDealsPages));
  }, [totalRecentDealsPages]);

  useEffect(() => {
    setFollowupsPage((current) => Math.min(current, totalFollowupsPages));
  }, [totalFollowupsPages]);

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
          const data = await fetchDashboard(range, pipelineType, dashboardFilters, controller.signal);
          setSummary(data.summary);
          setPipeline(data.pipeline);
          setTeamPerf(data.teamPerformance);
          setFollowups(data.followups);
          setRecentDeals(data.recentDeals);
        }
        setInsightsUpdatedAt(new Date());
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
  }, [dashboardFilters, pipelineType, range]);

  useEffect(() => {
    if (USE_MOCK) return undefined;

    const intervalId = window.setInterval(async () => {
      try {
        const data = await fetchDashboard(range, pipelineType, dashboardFilters);
        setSummary(data.summary);
        setPipeline(data.pipeline);
        setTeamPerf(data.teamPerformance);
        setFollowups(data.followups);
        setRecentDeals(data.recentDeals);
        setInsightsUpdatedAt(new Date());
      } catch (e) {
        console.error("Failed to refresh admin AI insights", e);
      }
    }, ADMIN_INSIGHTS_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [dashboardFilters, pipelineType, range]);

  const kpis = [
    {
      title: "Revenue (Won)",
      value: formatINR(summary.revenueWon),
      sub: `${summary.revenueDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.revenueDeltaPct
      )}% vs previous ${rangeLabel.toLowerCase()}`,
      sub: revenueWonSub,
      accent: "green",
    },
    {
      title: "Active Deals",
      value: String(summary.activeDeals),
      sub: `${summary.activeDealsDelta >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.activeDealsDelta
      )} added in ${rangeLabel.toLowerCase()}`,
      sub: `New Deals Created in ${rangeLabel}`,
      accent: "blue",
    },
    {
      title: "Win Rate",
      value: `${summary.winRatePct}%`,
      sub: `${summary.winRateDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.winRateDeltaPct
      )}% in ${rangeLabel.toLowerCase()}`,
      accent: "cyan",
    },
    {
      title: "Pipeline Value",
      value: formatINR(summary.pipelineValue),
      sub: `${summary.pipelineDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(
        summary.pipelineDeltaPct
      )}% vs target`,
      sub: "Total Value Of Open Deals",
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
          <DashboardDateFilter
            period={period}
            periodOptions={DASHBOARD_PERIOD_OPTIONS}
            month={selectedMonth}
            quarter={selectedQuarter}
            year={selectedYear}
            onPeriodChange={setPeriod}
            onMonthChange={setSelectedMonth}
            onQuarterChange={setSelectedQuarter}
            onYearChange={setSelectedYear}
            disabled={refreshing}
          />
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
                <div className="panel__titleRow">
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

                <CCardBody className="followupsPanelBody">
                  <div className="followList">
                    {visibleFollowups.length ? visibleFollowups.map((f) => (
                      <div key={f.id} className="followItem">
                        <div className="followIcon">{f.icon}</div>

                        <div className="followBody">
                          <div className="followTitle">{f.companyName || f.title}</div>
                          <div className="followMeta">
                            <span className="muted">{f.itemType || "Follow-up"}</span>
                            <span className="dot" />
                            <span className="muted">{f.title}</span>
                            {f.itemType !== "Meeting" && f.contactPhone ? (
                              <>
                                <span className="dot" />
                                <span className="muted">Mob: {f.contactPhone}</span>
                              </>
                            ) : null}
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
                    )) : (
                      <div className="followEmpty">No upcoming follow-ups found.</div>
                    )}
                  </div>
                  {followups.length ? (
                    <div className="admin-panel-pagination">
                      <Pagination
                        currentPage={followupsPage}
                        totalPages={totalFollowupsPages}
                        handlePageChange={setFollowupsPage}
                        showSinglePage
                      />
                    </div>
                  ) : null}
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
                        <CTableHeaderCell>Deal</CTableHeaderCell>
                        <CTableHeaderCell>Stage</CTableHeaderCell>
                        <CTableHeaderCell>Value</CTableHeaderCell>
                        <CTableHeaderCell>Expected Close Date</CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>

                    <CTableBody>
                      {visibleRecentDeals.map((d) => (
                        <CTableRow key={d.id}>
                          <CTableDataCell className="tbl__client">
                            {d.dealName}
                          </CTableDataCell>
                          <CTableDataCell>
                            <StagePill stage={d.stage} />
                          </CTableDataCell>
                          <CTableDataCell className="tbl__value">
                            {formatINR(d.value)}
                          </CTableDataCell>
                          <CTableDataCell className="muted">
                            {d.expectedCloseDate}
                          </CTableDataCell>
                        </CTableRow>
                      ))}
                    </CTableBody>
                  </CTable>
                  <div className="admin-panel-pagination admin-panel-pagination--table">
                    <Pagination
                      currentPage={recentDealsPage}
                      totalPages={totalRecentDealsPages}
                      handlePageChange={setRecentDealsPage}
                      showSinglePage
                    />
                  </div>
                </CCardBody>
              </CCard>

              <CCard className="panel panel--aiInsights">
                <CCardHeader className="panel__header">
                  <div className="panel__titleRow">
                    <span className="panel__title">AI Insights</span>
                    <AiBadge tone="priority">Live</AiBadge>
                  </div>
                  <CButton
                    color="light"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      navigate("/ai-insights?scope=company", {
                        state: { source: "main-dashboard" }
                      })
                    }
                  >
                    View All
                  </CButton>
                </CCardHeader>

                <CCardBody>
                  <div className="aiInsightsSummary">
                    <span>Important summary</span>
                    <strong>{adminAiSummary}</strong>
                    <small>Updated {formatLiveTime(insightsUpdatedAt)} from current dashboard data</small>
                  </div>
                  <div className="aiInsightsList">
                    {adminAiInsights.map((item) => (
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

