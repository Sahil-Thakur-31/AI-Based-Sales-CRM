// import {useState,useEffect} from 'react'
// import {useNavigate}  from 'react-router-dom'

// function AdminHome(){
//     const [loggedinUser,setLoggedinUser] = useState('');
//     const navigate = useNavigate();
//     useEffect(()=>{
//         setLoggedinUser(localStorage.getItem('Name'));
//     },[]);

//     const handleLogout = () =>{
//         localStorage.removeItem('token');
//         localStorage.removeItem('Name');
//         setTimeout(()=>{
//             navigate('/login');
//         },100);
//     }

//     return(
//         <div>
//             <p>{loggedinUser}</p>
//             <a href='/manageUsers'>Users</a>
//             <button type='submit' onClick={handleLogout}>Logout</button>
//         </div>
//     )
// }

// export default AdminHome;

import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "../styles/AdminHome.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const USE_MOCK = true;

/* ---------- helpers ---------- */
function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}
function formatINR(value) {
  const num = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(num)) return "₹0";
  return num.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}
function Badge({ children, tone = "ai" }) {
  return <span className={cx("badge", `badge--${tone}`)}>{children}</span>;
}
function Pill({ children }) {
  return <span className="pill">{children}</span>;
}
function Risk({ level }) {
  return <span className={cx("risk", `risk--${level}`)}>{level}</span>;
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const token = localStorage.getItem("token");
  const res = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `Request failed: ${res.status}`);
  }
  return res.json();
}

function getMockDashboard() {
  return {
    summary: {
      revenueWon: 4300000,
      revenueDeltaPct: 14.3,
      activeDeals: 4,
      activeDealsDelta: 3,
      winRatePct: 33,
      winRateDeltaPct: 5,
      pipelineValue: 16700000,
      pipelineDeltaPct: -2.1,
      openLeads: 5,
      openLeadsFromAI: 2,
    },
    pipeline: [
      { code: "P1", label: "Prospect", count: 0, amount: 0 },
      { code: "P2", label: "Qualified", count: 0, amount: 0 },
      { code: "P3", label: "In Conversation", count: 1, amount: 7200000 },
      { code: "P4", label: "Meeting Scheduled", count: 1, amount: 4500000 },
      { code: "P5", label: "Proposal Sent", count: 1, amount: 1800000 },
      { code: "P6", label: "Negotiation", count: 1, amount: 3200000 },
      { code: "P7", label: "Closed Won", count: 0, amount: 0 },
    ],
    teamPerformance: [
      { id: "u1", name: "Anil Sharma", value: 2140000, pct: 78 },
      { id: "u2", name: "Karan Singh", value: 1890000, pct: 62 },
      { id: "u3", name: "Neha Roy", value: 1420000, pct: 48 },
    ],
    followups: [
      { id: "f1", title: "TechNova - Product demo call", owner: "Anil Sharma", score: 92, date: "20 Mar 2025", priority: "high", icon: "📞" },
      { id: "f2", title: "Reliance - Proposal follow-up email", owner: "Priya Mehta", score: 78, date: "21 Mar 2025", priority: "medium", icon: "✉️" },
      { id: "f3", title: "Medanta - Contract signing meeting", owner: "Karan Singh", score: 95, date: "25 Mar 2025", priority: "high", icon: "🤝" },
    ],
    recentDeals: [
      { id: "d1", client: "TechNova Pvt Ltd", stage: "P5", value: 1800000, risk: "low", closeDate: "28 Mar 2025" },
      { id: "d2", client: "Reliance Infra", stage: "P4", value: 4500000, risk: "medium", closeDate: "15 Apr 2025" },
      { id: "d3", client: "Greenfield Solar", stage: "P3", value: 7200000, risk: "high", closeDate: "02 May 2025" },
      { id: "d4", client: "Medanta Hospitals", stage: "P6", value: 3200000, risk: "low", closeDate: "22 Mar 2025" },
    ],
  };
}

export default function AdminHome() {
  const [loggedinUser, setLoggedinUser] = useState("");
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    setLoggedinUser(localStorage.getItem("Name") || "Admin");
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("Name");
    setTimeout(() => navigate("/login"), 100);
  };

  const totalDeals = useMemo(() => pipeline.reduce((acc, p) => acc + (p.count || 0), 0), [pipeline]);

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      if (USE_MOCK) {
        const mock = getMockDashboard();
        setSummary(mock.summary);
        setPipeline(mock.pipeline);
        setTeamPerf(mock.teamPerformance);
        setFollowups(mock.followups);
        setRecentDeals(mock.recentDeals);
        setLoading(false);
        return;
      }

      // Example backend endpoints (change as per your backend)
      const [sum, pipe, team, fu, deals] = await Promise.all([
        apiGet("/api/admin/dashboard/summary", { range }),
        apiGet("/api/admin/dashboard/pipeline", { range }),
        apiGet("/api/admin/dashboard/team-performance", { range }),
        apiGet("/api/admin/dashboard/followups", { range: "week" }),
        apiGet("/api/admin/dashboard/recent-deals", { range }),
      ]);

      setSummary(sum);
      setPipeline(pipe);
      setTeamPerf(team);
      setFollowups(fu);
      setRecentDeals(deals);

      setLoading(false);
    } catch (e) {
      setError(e?.message || "Failed to load dashboard");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const kpis = [
    {
      title: "Revenue (Won)",
      value: formatINR(summary.revenueWon),
      sub: `${summary.revenueDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(summary.revenueDeltaPct)}% vs last month`,
      accent: summary.revenueDeltaPct >= 0 ? "green" : "pink",
    },
    { title: "Active Deals", value: String(summary.activeDeals), sub: `↑ ${summary.activeDealsDelta} this ${range}`, accent: "blue" },
    { title: "Win Rate", value: `${summary.winRatePct}%`, sub: `↑ ${summary.winRateDeltaPct}% QoQ`, accent: "cyan" },
    {
      title: "Pipeline Value",
      value: formatINR(summary.pipelineValue),
      sub: `${summary.pipelineDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(summary.pipelineDeltaPct)}% vs target`,
      accent: "purple",
    },
    { title: "Open Leads", value: String(summary.openLeads), sub: `↑ ${summary.openLeadsFromAI} from AI`, accent: "pink" },
  ];

  return (
    <div className="adminHome">
      <div className="adminHome__bg" />

      {/* Header / actions */}
      <div className="topBar">
       

        <div className="topActions">
          <select className="select" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
          </select>

        
        </div>
      </div>

      {error && (
        <div className="stateCard stateCard--error">
          <div className="stateTitle">Error</div>
          <div className="stateText">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="skeletonGrid">
          <div className="sk sk--kpi" />
          <div className="sk sk--kpi" />
          <div className="sk sk--kpi" />
          <div className="sk sk--kpi" />
          <div className="sk sk--kpi" />
          <div className="sk sk--panel" />
          <div className="sk sk--panel" />
          <div className="sk sk--panelWide" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="kpiGrid">
            {kpis.map((c) => (
              <div key={c.title} className={cx("card", "kpi", `kpi--${c.accent}`)}>
                <p className="kpi__title">{c.title}</p>
                <h2 className="kpi__value">{c.value}</h2>
                <p className="kpi__sub">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="mainGrid">
            {/* Pipeline */}
            <div className={cx("card", "panel", "panel--pipeline")}>
              <div className="panel__header">
                <div className="panel__titleRow">
                  <h3 className="panel__title">Deal Pipeline</h3>
                  <Badge>AI Scored</Badge>
                </div>
                <div className="panel__meta">{range.toUpperCase()}</div>
              </div>

              <div className="stageStrip">
                {pipeline.map((p, idx) => (
                  <div key={p.code} className={cx("stageChip", `stageChip--${idx + 1}`)}>
                    <div className="stageChip__code">{p.code}</div>
                    <div className="stageChip__count">{p.count}</div>
                  </div>
                ))}
              </div>

              <div className="bars">
                {pipeline.map((p) => {
                  const width = totalDeals === 0 ? 0 : Math.round((p.count / totalDeals) * 100);
                  const fill = Math.max(width, p.count > 0 ? 12 : 0);
                  return (
                    <div key={p.code} className="barRow">
                      <div className="barRow__left">
                        <span className="barRow__label">{p.code}</span>
                      </div>
                      <div className="barRow__mid">
                        <div className="barTrack">
                          <div className="barFill" style={{ width: `${fill}%` }} />
                        </div>
                      </div>
                      <div className="barRow__right">
                        <div className="barRow__nums">
                          <span className="muted">{p.count} deals</span>
                          <span className="muted">{formatINR(p.amount)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right column */}
            <div className="rightCol">
              {/* Team performance */}
              <div className={cx("card", "panel")}>
                <div className="panel__header">
                  <h3 className="panel__title">Team Performance</h3>
                  <div className="panel__meta">Top performers</div>
                </div>

                <div className="teamList">
                  {teamPerf.map((m, i) => (
                    <div key={m.id} className="teamItem">
                      <div className="teamItem__name">{m.name}</div>
                      <div className="teamItem__bar">
                        <div className="miniTrack">
                          <div
                            className={cx("miniFill", i === 0 ? "miniFill--green" : i === 1 ? "miniFill--cyan" : "miniFill--yellow")}
                            style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }}
                          />
                        </div>
                      </div>
                      <div className="teamItem__value">{formatINR(m.value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Followups */}
              <div className={cx("card", "panel")}>
                <div className="panel__header">
                  <div className="panel__titleRow">
                    <h3 className="panel__title">Upcoming Follow-ups</h3>
                    <Badge tone="priority">AI Priority</Badge>
                  </div>
                  <div className="panel__meta">This week</div>
                </div>

                <div className="followList">
                  {followups.map((f) => (
                    <div key={f.id} className="followItem">
                      <div className="followIcon">{f.icon}</div>
                      <div className="followBody">
                        <div className="followTitle">{f.title}</div>
                        <div className="followMeta">
                          <span className="muted">{f.owner}</span>
                          <span className="dot" />
                          <span className="muted">Score: {f.score}</span>
                        </div>
                      </div>
                      <div className="followRight">
                        <div className="muted">{f.date}</div>
                        <div className={cx("prio", `prio--${f.priority}`)}>{f.priority}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <button className="btnGhost btnCenter">View All</button>
              </div>
            </div>

            {/* Recent deals */}
            <div className={cx("card", "panel", "panel--deals")}>
              <div className="panel__header">
                <div className="panel__titleRow">
                  <h3 className="panel__title">Recent Deals</h3>
                  <button className="btnNeon">View All</button>
                </div>
              </div>

              <div className="tableWrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Stage</th>
                      <th>Value</th>
                      <th>Risk</th>
                      <th>Close Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeals.map((d) => (
                      <tr key={d.id}>
                        <td className="tbl__client">{d.client}</td>
                        <td>
                          <Pill>{d.stage}</Pill>
                        </td>
                        <td className="tbl__value">{formatINR(d.value)}</td>
                        <td>
                          <Risk level={d.risk} />
                        </td>
                        <td className="muted">{d.closeDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}