import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/teamDashboard.css";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function emptyDashboard(team = null) {
  return {
    team: team || {
      _id: "",
      name: "",
      leadCount: 0,
      memberCount: 0,
      totalPeople: 0
    },
    teamLeads: [],
    members: [],
    kpis: {
      followupsToday: 0,
      activeDeals: 0,
      pipelineValue: 0,
      winRate: 0,
      wonRevenue: 0,
      closedDeals: 0
    },
    followups: [],
    stageDistribution: [],
    memberPerformance: [],
    insights: []
  };
}

export default function TeamDashboard() {
  const navigate = useNavigate();
  const roleName = localStorage.getItem("RoleName") || "";
  const canCreateTeam = roleName === "Admin";

  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [dashboardData, setDashboardData] = useState(emptyDashboard());
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState("");

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team._id) === String(selectedTeamId)) || null,
    [teams, selectedTeamId]
  );

  const loadTeams = useCallback(async () => {
    try {
      setLoadingTeams(true);
      setError("");

      const res = await API.get("/teams");
      const teamRows = Array.isArray(res.data) ? res.data : [];
      setTeams(teamRows);

      if (!teamRows.length) {
        setSelectedTeamId("");
        setDashboardData(emptyDashboard());
        return;
      }

      const hasSelected = teamRows.some((team) => String(team._id) === String(selectedTeamId));
      if (!hasSelected) {
        setSelectedTeamId(String(teamRows[0]._id));
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to load teams");
      setTeams([]);
      setSelectedTeamId("");
      setDashboardData(emptyDashboard());
    } finally {
      setLoadingTeams(false);
    }
  }, [selectedTeamId]);

  const loadDashboard = useCallback(async (teamId) => {
    if (!teamId) return;

    try {
      setLoadingDashboard(true);
      setError("");

      const res = await API.get(`/teams/dashboard?teamId=${teamId}`);
      setDashboardData(res.data || emptyDashboard());
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to load dashboard");
      setDashboardData(emptyDashboard(selectedTeam));
    } finally {
      setLoadingDashboard(false);
    }
  }, [selectedTeam]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (selectedTeamId) {
      loadDashboard(selectedTeamId);
    }
  }, [selectedTeamId, loadDashboard]);

  const onRefresh = async () => {
    await loadTeams();
    if (selectedTeamId) {
      await loadDashboard(selectedTeamId);
    }
  };

  const kpiCards = [
    {
      label: "Follow-ups Today",
      value: dashboardData.kpis.followupsToday
    },
    {
      label: "Active Deals",
      value: dashboardData.kpis.activeDeals
    },
    {
      label: "Pipeline Value",
      value: formatCurrency(dashboardData.kpis.pipelineValue)
    },
    {
      label: "Win Rate",
      value: `${dashboardData.kpis.winRate || 0}%`
    },
    {
      label: "Won Revenue",
      value: formatCurrency(dashboardData.kpis.wonRevenue)
    },
    {
      label: "Closed Deals",
      value: dashboardData.kpis.closedDeals
    }
  ];

  if (loadingTeams) {
    return <div className="team-dashboard-loading">Loading team dashboard...</div>;
  }

  if (!teams.length) {
    return (
      <div className="team-dashboard-empty">
        <h3>No Teams Available</h3>
        <p>
          {canCreateTeam
            ? "Create a team to start tracking member performance and pipeline."
            : "You are not assigned to any team yet. Contact your administrator."}
        </p>
        {canCreateTeam ? (
          <button className="team-btn team-btn-primary" onClick={() => navigate("/team-setup")}>
            Create Team
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="team-dashboard-page">
      <div className="team-dashboard-toolbar">
        <div className="team-toolbar-left">
          {canCreateTeam ? (
            <button className="team-btn team-btn-primary" onClick={() => navigate("/team-setup")}>
              Create Team
            </button>
          ) : null}
        </div>

        <div className="team-toolbar-right">
          <select
            className="team-dashboard-select"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            {teams.map((team) => (
              <option key={team._id} value={team._id}>
                {team.name || "Untitled Team"} ({team.totalPeople || 0})
              </option>
            ))}
          </select>

          <button className="team-btn team-btn-secondary" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="team-dashboard-error">{error}</div> : null}

      <div className="team-dashboard-summary">
        {kpiCards.map((card) => (
          <div key={card.label} className="team-kpi-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="team-dashboard-grid">
        <section className="team-panel">
          <div className="team-panel-head">
            <h3>Team Leads</h3>
            <small>{dashboardData.teamLeads.length}</small>
          </div>
          <div className="team-people-list">
            {dashboardData.teamLeads.length ? (
              dashboardData.teamLeads.map((user) => (
                <div key={user._id} className="team-person-row">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
              ))
            ) : (
              <div className="team-muted">No team leads assigned</div>
            )}
          </div>
        </section>

        <section className="team-panel">
          <div className="team-panel-head">
            <h3>Team Members</h3>
            <small>{dashboardData.members.length}</small>
          </div>
          <div className="team-people-list">
            {dashboardData.members.length ? (
              dashboardData.members.map((user) => (
                <div key={user._id} className="team-person-row">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
              ))
            ) : (
              <div className="team-muted">No members assigned</div>
            )}
          </div>
        </section>
      </div>

      <div className="team-dashboard-grid team-dashboard-grid-wide">
        <section className="team-panel team-panel-span-2">
          <div className="team-panel-head">
            <h3>Member Performance</h3>
            {loadingDashboard ? <small>Refreshing...</small> : null}
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Open</th>
                  <th>Won</th>
                  <th>Lost</th>
                  <th>Follow-ups</th>
                  <th>Win Rate</th>
                  <th>Pipeline</th>
                  <th>Won Revenue</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData.memberPerformance.length ? (
                  dashboardData.memberPerformance.map((row) => (
                    <tr key={row.user._id}>
                      <td>
                        <div className="team-cell-user">
                          <strong>{row.user.name}</strong>
                          <span>{row.user.email}</span>
                        </div>
                      </td>
                      <td>{row.openDeals}</td>
                      <td>{row.wonDeals}</td>
                      <td>{row.lostDeals}</td>
                      <td>{row.followupsToday}</td>
                      <td>{row.winRate}%</td>
                      <td>{formatCurrency(row.pipelineValue)}</td>
                      <td>{formatCurrency(row.wonRevenue)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="team-table-empty">
                      No performance data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="team-panel">
          <div className="team-panel-head">
            <h3>Stage Distribution</h3>
          </div>
          <div className="team-stage-list">
            {dashboardData.stageDistribution.length ? (
              dashboardData.stageDistribution.map((item) => (
                <div key={item.stage} className="team-stage-row">
                  <span>{item.stage}</span>
                  <div className="team-stage-bar">
                    <span
                      style={{
                        width: `${Math.min(100, (item.count || 0) * 14)}%`
                      }}
                    />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="team-muted">No active stage data</div>
            )}
          </div>
        </section>
      </div>

      <div className="team-dashboard-grid team-dashboard-grid-wide">
        <section className="team-panel team-panel-span-2">
          <div className="team-panel-head">
            <h3>Follow-ups Due Today</h3>
            <small>{dashboardData.followups.length}</small>
          </div>
          <div className="team-followups-list">
            {dashboardData.followups.length ? (
              dashboardData.followups.map((followup) => (
                <div key={followup._id} className="team-followup-row">
                  <div className="team-followup-main">
                    <strong>{followup.companyName}</strong>
                    <p>{followup.message || followup.nextAction || "No note"}</p>
                    <span>
                      Owner: {followup.assignedTo?.name || "Unassigned"} | Priority:{" "}
                      {followup.temperature || "cold"}
                    </span>
                  </div>
                  <div className="team-followup-time">{formatDateTime(followup.lastContactDate)}</div>
                </div>
              ))
            ) : (
              <div className="team-muted">No follow-ups due today</div>
            )}
          </div>
        </section>

        <section className="team-panel">
          <div className="team-panel-head">
            <h3>Insights</h3>
          </div>
          <div className="team-insights-list">
            {dashboardData.insights.length ? (
              dashboardData.insights.map((insight, index) => (
                <div key={`${insight.type}-${index}`} className="team-insight-row">
                  <strong>{String(insight.type || "insight").replace("-", " ")}</strong>
                  <p>{insight.message}</p>
                </div>
              ))
            ) : (
              <div className="team-muted">No insights available</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
