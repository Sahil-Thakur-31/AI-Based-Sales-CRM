import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
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

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
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

function emptyMemberDetail() {
  return {
    target: null,
    deals: {
      open: [],
      won: [],
      lost: []
    },
    followups: []
  };
}

function emptyPipelineDetail() {
  return {
    totals: {
      count: 0,
      value: 0
    },
    stages: []
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
  const [performancePage, setPerformancePage] = useState(1);
  const [followupPage, setFollowupPage] = useState(1);
  const [selectedPerformanceRow, setSelectedPerformanceRow] = useState(null);
  const [selectedFollowupRow, setSelectedFollowupRow] = useState(null);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineDetailLoading, setPipelineDetailLoading] = useState(false);
  const [pipelineDetailError, setPipelineDetailError] = useState("");
  const [pipelineDetailData, setPipelineDetailData] = useState(emptyPipelineDetail());
  const [memberDetailTab, setMemberDetailTab] = useState("deals");
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [memberDetailError, setMemberDetailError] = useState("");
  const [memberDetailData, setMemberDetailData] = useState(emptyMemberDetail());

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team._id) === String(selectedTeamId)) || null,
    [teams, selectedTeamId]
  );
  const canAssignTargets = roleName === "Admin" || Boolean(selectedTeam?.canManage);

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
      setPerformancePage(1);
      setFollowupPage(1);
    }
  }, [selectedTeamId, loadDashboard]);

  const onRefresh = async () => {
    await loadTeams();
    if (selectedTeamId) {
      await loadDashboard(selectedTeamId);
    }
  };

  const closeMemberDetail = () => {
    setSelectedPerformanceRow(null);
    setMemberDetailTab("deals");
    setMemberDetailLoading(false);
    setMemberDetailError("");
    setMemberDetailData(emptyMemberDetail());
  };

  const openMemberDetail = async (row) => {
    if (!row?.user?._id || !selectedTeamId) return;

    setSelectedPerformanceRow(row);
    setMemberDetailTab("deals");
    setMemberDetailLoading(true);
    setMemberDetailError("");
    setMemberDetailData(emptyMemberDetail());

    try {
      const res = await API.get(
        `/teams/member-detail?teamId=${selectedTeamId}&memberId=${row.user._id}`
      );
      const payload = res.data || {};

      setMemberDetailData({
        target: payload?.target || null,
        deals: {
          open: Array.isArray(payload?.deals?.open) ? payload.deals.open : [],
          won: Array.isArray(payload?.deals?.won) ? payload.deals.won : [],
          lost: Array.isArray(payload?.deals?.lost) ? payload.deals.lost : []
        },
        followups: Array.isArray(payload?.followups) ? payload.followups : []
      });
    } catch (err) {
      console.error(err);
      setMemberDetailError(err.response?.data?.message || "Failed to load member detail");
    } finally {
      setMemberDetailLoading(false);
    }
  };

  const closePipelineDetail = () => {
    setShowPipelineModal(false);
    setPipelineDetailLoading(false);
    setPipelineDetailError("");
    setPipelineDetailData(emptyPipelineDetail());
  };

  const openPipelineDetail = async () => {
    if (!selectedTeamId) return;

    setShowPipelineModal(true);
    setPipelineDetailLoading(true);
    setPipelineDetailError("");
    setPipelineDetailData(emptyPipelineDetail());

    try {
      const res = await API.get(`/teams/pipeline-detail?teamId=${selectedTeamId}`);
      const payload = res.data || {};
      setPipelineDetailData({
        totals: {
          count: Number(payload?.totals?.count) || 0,
          value: Number(payload?.totals?.value) || 0
        },
        stages: Array.isArray(payload?.stages) ? payload.stages : []
      });
    } catch (err) {
      console.error(err);
      setPipelineDetailError(err.response?.data?.message || "Failed to load pipeline details");
    } finally {
      setPipelineDetailLoading(false);
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

  const teamLeadId = String(
    dashboardData.team?.teamLeadId || dashboardData.teamLeads?.[0]?._id || ""
  );

  const performancePageSize = 5;
  const followupPageSize = 5;

  const totalPerformancePages = Math.max(
    1,
    Math.ceil((dashboardData.memberPerformance?.length || 0) / performancePageSize)
  );
  const totalFollowupPages = Math.max(
    1,
    Math.ceil((dashboardData.followups?.length || 0) / followupPageSize)
  );

  useEffect(() => {
    if (performancePage > totalPerformancePages) {
      setPerformancePage(totalPerformancePages);
    }
  }, [performancePage, totalPerformancePages]);

  useEffect(() => {
    if (followupPage > totalFollowupPages) {
      setFollowupPage(totalFollowupPages);
    }
  }, [followupPage, totalFollowupPages]);

  const paginatedPerformance = useMemo(() => {
    const start = (performancePage - 1) * performancePageSize;
    return (dashboardData.memberPerformance || []).slice(start, start + performancePageSize);
  }, [dashboardData.memberPerformance, performancePage]);

  const paginatedFollowups = useMemo(() => {
    const start = (followupPage - 1) * followupPageSize;
    return (dashboardData.followups || []).slice(start, start + followupPageSize);
  }, [dashboardData.followups, followupPage]);

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
          {canAssignTargets ? (
            <button
              className="team-btn team-btn-primary"
              onClick={() => navigate(`/team-targets?teamId=${selectedTeamId}`)}
            >
              Assign Targets
            </button>
          ) : null}

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

      <div className="team-dashboard-main">
        <div className="team-main-left">
          <section className="team-panel team-panel-performance">
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPerformance.length ? (
                    paginatedPerformance.map((row) => (
                      <tr key={row.user._id}>
                        <td>
                          <div className="team-cell-user">
                            <strong title={row.user.name}>
                              {row.user.name}
                              {String(row.user._id) === teamLeadId ? (
                                <span className="team-lead-badge">Lead</span>
                              ) : null}
                            </strong>
                            <span title={row.user.email}>{row.user.email}</span>
                          </div>
                        </td>
                        <td>{row.openDeals}</td>
                        <td>{row.wonDeals}</td>
                        <td>{row.lostDeals}</td>
                        <td>{row.followupsToday}</td>
                        <td>{row.winRate}%</td>
                        <td>
                          <button
                            className="team-inline-view-btn"
                            onClick={() => openMemberDetail(row)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="team-table-empty">
                        No performance data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="team-panel-pagination">
              <Pagination
                currentPage={performancePage}
                totalPages={totalPerformancePages}
                handlePageChange={setPerformancePage}
              />
            </div>
          </section>

          <section className="team-panel team-panel-followups">
            <div className="team-panel-head">
              <h3>Follow-ups Due Today</h3>
              <small>{dashboardData.followups.length}</small>
            </div>
            <div className="team-followups-list">
              {paginatedFollowups.length ? (
                paginatedFollowups.map((followup) => (
                  <div key={followup._id} className="team-followup-row">
                    <div className="team-followup-main">
                      <strong title={followup.companyName}>{followup.companyName}</strong>
                      <p title={followup.message || followup.nextAction || "No note"}>
                        {followup.message || followup.nextAction || "No note"}
                      </p>
                      <span title={`Assigned To: ${followup.assignedTo?.name || "Unassigned"} | Type: ${followup.temperature || "cold"}`}>
                        Assigned To: {followup.assignedTo?.name || "Unassigned"} | Type:{" "}
                        {followup.temperature || "cold"}
                      </span>
                    </div>
                    <div className="team-followup-side">
                      <div className="team-followup-time">{formatDateTime(followup.lastContactDate)}</div>
                      <button
                        className="team-inline-view-btn"
                        onClick={() => setSelectedFollowupRow(followup)}
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="team-muted">No follow-ups due today</div>
              )}
            </div>
            <div className="team-panel-pagination">
              <Pagination
                currentPage={followupPage}
                totalPages={totalFollowupPages}
                handlePageChange={setFollowupPage}
              />
            </div>
          </section>
        </div>

        <div className="team-main-right">
          <section className="team-panel team-panel-stage">
            <div className="team-panel-head">
              <h3>Pipeline</h3>
              <button className="team-inline-view-btn" onClick={openPipelineDetail}>
                View
              </button>
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

          <section className="team-panel team-panel-insights">
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

      {showPipelineModal ? (
        <div className="team-modal-overlay" onClick={closePipelineDetail}>
          <div className="team-modal-card team-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-head">
              <h3>Pipeline Detail</h3>
              <button className="team-modal-close" onClick={closePipelineDetail}>
                Close
              </button>
            </div>
            <div className="team-modal-body">
              <div className="team-modal-grid">
                <div>
                  <span className="team-modal-label">Team</span>
                  <strong className="team-modal-value">{selectedTeam?.name || "-"}</strong>
                </div>
                <div>
                  <span className="team-modal-label">Active Deals</span>
                  <strong className="team-modal-value">{pipelineDetailData.totals.count || 0}</strong>
                </div>
                <div>
                  <span className="team-modal-label">Pipeline Value</span>
                  <strong className="team-modal-value">
                    {formatCurrency(pipelineDetailData.totals.value || 0)}
                  </strong>
                </div>
                <div>
                  <span className="team-modal-label">Win Rate</span>
                  <strong className="team-modal-value">{dashboardData.kpis.winRate || 0}%</strong>
                </div>
              </div>

              {pipelineDetailLoading ? (
                <div className="team-muted">Loading pipeline details...</div>
              ) : null}

              {!pipelineDetailLoading && pipelineDetailError ? (
                <div className="team-modal-error">{pipelineDetailError}</div>
              ) : null}

              {!pipelineDetailLoading && !pipelineDetailError ? (
                <div className="team-member-sections">
                  {(pipelineDetailData.stages || []).map((stage) => (
                    <section key={stage.stage} className="team-member-section">
                      <div className="team-member-section-head">
                        <h4>{stage.stage}</h4>
                        <small>
                          {stage.count || 0} deal(s) | {formatCurrency(stage.value || 0)}
                        </small>
                      </div>

                      {Array.isArray(stage.deals) && stage.deals.length ? (
                        <div className="team-member-list">
                          {stage.deals.map((deal) => (
                            <div key={deal._id} className="team-member-deal-row">
                              <div className="team-member-deal-main">
                                <strong title={deal.companyName}>{deal.companyName || "-"}</strong>
                                <span>{deal._id ? `Deal ID: ${deal._id}` : "Deal ID: -"}</span>
                                <span>
                                  Owner: {deal.assignedTo?.name || "Unassigned"}
                                  {deal.assignedTo?.email ? ` (${deal.assignedTo.email})` : ""}
                                </span>
                              </div>
                              <div className="team-member-deal-meta">
                                <span>{formatCurrency(deal.dealValue || 0)}</span>
                                <span>Prob: {Number(deal.probability) || 0}%</span>
                                <span>Close: {formatDate(deal.expectedCloseDate)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="team-muted">No deals in {stage.stage}.</div>
                      )}
                    </section>
                  ))}
                  {!pipelineDetailData.stages?.length ? (
                    <div className="team-muted">No active stage data</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
 
      {selectedPerformanceRow ? (
        <div className="team-modal-overlay" onClick={closeMemberDetail}>
          <div className="team-modal-card team-modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-head">
              <h3>Member Detail</h3>
              <button className="team-modal-close" onClick={closeMemberDetail}>
                Close
              </button>
            </div>
            <div className="team-modal-body">
              <div className="team-user-line">
                <strong>
                  {selectedPerformanceRow.user?.name}
                  {String(selectedPerformanceRow.user?._id) === teamLeadId ? (
                    <span className="team-lead-badge">Lead</span>
                  ) : null}
                </strong>
                <span>{selectedPerformanceRow.user?.email}</span>
              </div>

              {memberDetailData.target ? (
                <div className="team-target-progress-card">
                  <div className="team-target-progress-head">
                    <h4>Target Progress</h4>
                    <small>Ends: {formatDate(memberDetailData.target.periodEnd)}</small>
                  </div>
                  <div className="team-target-progress-track">
                    <span style={{ width: `${Math.max(0, Math.min(100, memberDetailData.target.progressPercent || 0))}%` }} />
                  </div>
                  <div className="team-target-progress-meta">
                    <div>
                      <span>Assigned</span>
                      <strong>{formatCurrency(memberDetailData.target.revenueTarget || 0)}</strong>
                    </div>
                    <div>
                      <span>Achieved</span>
                      <strong>{formatCurrency(memberDetailData.target.achievedRevenue || 0)}</strong>
                    </div>
                    <div>
                      <span>Progress</span>
                      <strong>{memberDetailData.target.progressPercent || 0}%</strong>
                    </div>
                    <div>
                      <span>Deals</span>
                      <strong>
                        {memberDetailData.target.achievedDeals || 0}/{memberDetailData.target.dealTarget || 0}
                      </strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="team-muted">No target assigned for this member.</div>
              )}

              <div className="team-member-tabs">
                <button
                  type="button"
                  className={memberDetailTab === "deals" ? "active" : ""}
                  onClick={() => setMemberDetailTab("deals")}
                >
                  Deals
                </button>
                <button
                  type="button"
                  className={memberDetailTab === "followups" ? "active" : ""}
                  onClick={() => setMemberDetailTab("followups")}
                >
                  Today's Follow-ups
                </button>
              </div>

              {memberDetailLoading ? (
                <div className="team-muted">Loading member details...</div>
              ) : null}

              {!memberDetailLoading && memberDetailError ? (
                <div className="team-modal-error">{memberDetailError}</div>
              ) : null}

              {!memberDetailLoading && !memberDetailError && memberDetailTab === "deals" ? (
                <div className="team-member-sections">
                  {[
                    { key: "open", label: "Open Deals" },
                    { key: "won", label: "Won Deals" },
                    { key: "lost", label: "Lost Deals" }
                  ].map((section) => {
                    const deals = memberDetailData.deals?.[section.key] || [];
                    return (
                      <section key={section.key} className="team-member-section">
                        <div className="team-member-section-head">
                          <h4>{section.label}</h4>
                          <small>{deals.length}</small>
                        </div>
                        {deals.length ? (
                          <div className="team-member-list">
                            {deals.map((deal) => (
                              <div key={deal._id} className="team-member-deal-row">
                                <div className="team-member-deal-main">
                                  <strong title={deal.companyName}>{deal.companyName || "-"}</strong>
                                  <span>{deal._id ? `Deal ID: ${deal._id}` : "Deal ID: -"}</span>
                                </div>
                                <div className="team-member-deal-meta">
                                  <span>{deal.stage || "-"}</span>
                                  <span>{formatCurrency(deal.dealValue || 0)}</span>
                                  <span>{formatDate(deal.expectedCloseDate)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="team-muted">No {section.label.toLowerCase()}.</div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : null}

              {!memberDetailLoading && !memberDetailError && memberDetailTab === "followups" ? (
                <section className="team-member-section">
                  <div className="team-member-section-head">
                    <h4>Follow-ups for Today</h4>
                    <small>{memberDetailData.followups.length}</small>
                  </div>
                  {memberDetailData.followups.length ? (
                    <div className="team-member-list">
                      {memberDetailData.followups.map((followup) => (
                        <div key={followup._id} className="team-member-followup-row">
                          <div className="team-member-followup-main">
                            <strong title={followup.title}>{followup.title || "-"}</strong>
                            <span title={followup.companyName}>{followup.companyName || "-"}</span>
                            <span>{formatDateTime(followup.dueDateTime)}</span>
                          </div>
                          <div className="team-member-followup-tags">
                            <span className="team-member-pill">{followup.actionType || followup.kind || "-"}</span>
                            <span className="team-member-pill">{followup.entityType || "-"}</span>
                            <span
                              className={`team-member-pill ${
                                followup.isCompleted ? "team-member-pill-completed" : "team-member-pill-pending"
                              }`}
                            >
                              {followup.isCompleted ? "Completed" : "Pending"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="team-muted">No follow-ups due today for this member.</div>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedFollowupRow ? (
        <div className="team-modal-overlay" onClick={() => setSelectedFollowupRow(null)}>
          <div className="team-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-head">
              <h3>Follow-up Detail</h3>
              <button className="team-modal-close" onClick={() => setSelectedFollowupRow(null)}>
                Close
              </button>
            </div>
            <div className="team-modal-body">
              <div className="team-modal-grid">
                <div>
                  <span className="team-modal-label">Company</span>
                  <strong className="team-modal-value">{selectedFollowupRow.companyName || "-"}</strong>
                </div>
                <div>
                  <span className="team-modal-label">Assigned To</span>
                  <strong className="team-modal-value">
                    {selectedFollowupRow.assignedTo?.name || "Unassigned"}
                  </strong>
                </div>
                <div>
                  <span className="team-modal-label">Follow-up Type</span>
                  <strong className="team-modal-value">{selectedFollowupRow.temperature || "-"}</strong>
                </div>
                <div>
                  <span className="team-modal-label">Last Contact</span>
                  <strong className="team-modal-value">
                    {formatDateTime(selectedFollowupRow.lastContactDate)}
                  </strong>
                </div>
              </div>

              <div className="team-modal-section">
                <h4>Message</h4>
                <p className="team-modal-text">{selectedFollowupRow.message || "-"}</p>
              </div>

              <div className="team-modal-section">
                <h4>Next Action</h4>
                <p className="team-modal-text">{selectedFollowupRow.nextAction || "-"}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
