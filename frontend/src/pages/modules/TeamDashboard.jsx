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
      closedDeals: 0,
      totalLeads: 0
    },
    leads: {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      rejected: 0,
      hot: 0,
      warm: 0,
      cold: 0
    },
    recentLeads: [],
    pipeline: {
      lead: {
        totals: { count: 0, value: 0 },
        stages: []
      },
      deal: {
        totals: { count: 0, value: 0 },
        stages: []
      }
    },
    followups: {
      lead: [],
      deal: []
    },
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
    leads: [],
    leadSummary: {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      rejected: 0,
      hot: 0,
      warm: 0,
      cold: 0
    },
    followups: []
  };
}

function emptyPipelineDetail() {
  return {
    pipelineType: "deal",
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
  const [followupViewType, setFollowupViewType] = useState("lead");
  const [pipelineViewType, setPipelineViewType] = useState("deal");
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineDetailType, setPipelineDetailType] = useState("deal");
  const [pipelineDetailLoading, setPipelineDetailLoading] = useState(false);
  const [pipelineDetailError, setPipelineDetailError] = useState("");
  const [pipelineDetailData, setPipelineDetailData] = useState(emptyPipelineDetail());
  const [memberDetailTab, setMemberDetailTab] = useState("deals");
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [memberDetailError, setMemberDetailError] = useState("");
  const [memberDetailData, setMemberDetailData] = useState(emptyMemberDetail());
  const [pipelineFilters, setPipelineFilters] = useState({
    query: "",
    stage: "all"
  });
  const [memberDealFilters, setMemberDealFilters] = useState({
    query: "",
    status: "all",
    stage: "all"
  });
  const [memberFollowupFilters, setMemberFollowupFilters] = useState({
    query: "",
    status: "all",
    entityType: "all"
  });
  const [memberLeadFilters, setMemberLeadFilters] = useState({
    query: "",
    status: "all",
    temperature: "all"
  });

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team._id) === String(selectedTeamId)) || null,
    [teams, selectedTeamId]
  );
  const canAssignTargets = roleName === "Admin" || Boolean(selectedTeam?.canManage);
  const assignTargetsPath =
    roleName === "Admin"
      ? `/team-targets/admin?teamId=${selectedTeamId}`
      : `/team-targets/manage?teamId=${selectedTeamId}`;

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
      setFollowupViewType("lead");
      setPipelineViewType("deal");
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
    setMemberDealFilters({ query: "", status: "all", stage: "all" });
    setMemberFollowupFilters({ query: "", status: "all", entityType: "all" });
    setMemberLeadFilters({ query: "", status: "all", temperature: "all" });
  };

  const openMemberDetail = async (row) => {
    if (!row?.user?._id || !selectedTeamId) return;

    setSelectedPerformanceRow(row);
    setMemberDetailTab("deals");
    setMemberDetailLoading(true);
    setMemberDetailError("");
    setMemberDetailData(emptyMemberDetail());
    setMemberDealFilters({ query: "", status: "all", stage: "all" });
    setMemberFollowupFilters({ query: "", status: "all", entityType: "all" });
    setMemberLeadFilters({ query: "", status: "all", temperature: "all" });

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
        leads: Array.isArray(payload?.leads) ? payload.leads : [],
        leadSummary: payload?.leadSummary || {
          total: 0,
          new: 0,
          contacted: 0,
          qualified: 0,
          converted: 0,
          rejected: 0,
          hot: 0,
          warm: 0,
          cold: 0
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
    setPipelineFilters({ query: "", stage: "all" });
  };

  const loadPipelineDetail = useCallback(
    async (type = "deal") => {
      if (!selectedTeamId) return;

      setPipelineDetailLoading(true);
      setPipelineDetailError("");
      setPipelineDetailData(emptyPipelineDetail());
      setPipelineFilters({ query: "", stage: "all" });

      try {
        const res = await API.get(
          `/teams/pipeline-detail?teamId=${selectedTeamId}&pipelineType=${type}`
        );
        const payload = res.data || {};
        setPipelineDetailData({
          pipelineType: String(payload?.pipelineType || type || "deal"),
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
    },
    [selectedTeamId]
  );

  const openPipelineDetail = async (type = pipelineViewType) => {
    if (!selectedTeamId) return;

    setShowPipelineModal(true);
    setPipelineDetailType(type);
    await loadPipelineDetail(type);
  };

  const switchPipelineDetailType = async (type) => {
    if (!showPipelineModal) return;
    if (type === pipelineDetailType) return;
    setPipelineDetailType(type);
    await loadPipelineDetail(type);
  };

  const kpiCards = [
    {
      label: "Total Leads",
      value: dashboardData.kpis.totalLeads ?? dashboardData.leads?.total ?? 0
    },
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
  const followupPageSize = 4;
  const followupRowsByType = useMemo(
    () => ({
      lead: Array.isArray(dashboardData.followups?.lead) ? dashboardData.followups.lead : [],
      deal: Array.isArray(dashboardData.followups?.deal) ? dashboardData.followups.deal : []
    }),
    [dashboardData.followups]
  );
  const activeFollowupRows = useMemo(
    () => followupRowsByType[followupViewType] || [],
    [followupRowsByType, followupViewType]
  );

  const totalPerformancePages = Math.max(
    1,
    Math.ceil((dashboardData.memberPerformance?.length || 0) / performancePageSize)
  );
  const totalFollowupPages = Math.max(
    1,
    Math.ceil((activeFollowupRows.length || 0) / followupPageSize)
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

  useEffect(() => {
    setFollowupPage(1);
  }, [followupViewType]);

  const paginatedPerformance = useMemo(() => {
    const start = (performancePage - 1) * performancePageSize;
    return (dashboardData.memberPerformance || []).slice(start, start + performancePageSize);
  }, [dashboardData.memberPerformance, performancePage]);

  const paginatedFollowups = useMemo(() => {
    const start = (followupPage - 1) * followupPageSize;
    return activeFollowupRows.slice(start, start + followupPageSize);
  }, [activeFollowupRows, followupPage]);

  const pipelineFlatRecords = useMemo(
    () =>
      (pipelineDetailData.stages || []).flatMap((stage) =>
        (stage.items || stage.deals || stage.leads || []).map((item) => ({
          ...item,
          stageLabel: stage.stage
        }))
      ),
    [pipelineDetailData.stages]
  );

  const pipelineStageOptions = useMemo(
    () => [...new Set(pipelineFlatRecords.map((item) => item.stageLabel).filter(Boolean))],
    [pipelineFlatRecords]
  );

  const filteredPipelineRecords = useMemo(() => {
    const query = pipelineFilters.query.trim().toLowerCase();
    return pipelineFlatRecords.filter((item) => {
      const stageOk = pipelineFilters.stage === "all" || (item.stageLabel || "") === pipelineFilters.stage;
      if (!stageOk) return false;
      if (!query) return true;

      const haystack = [
        item._id,
        item.companyName,
        item.assignedTo?.name,
        item.assignedTo?.email,
        item.stageLabel,
        item.status,
        item.actionType,
        item.title
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [pipelineFilters, pipelineFlatRecords]);

  const filteredPipelineStageSummary = useMemo(() => {
    const stageMap = new Map();
    filteredPipelineRecords.forEach((item) => {
      const key = item.stageLabel || "-";
      const itemValue = Number(item.dealValue ?? item.estimatedValue ?? 0) || 0;
      const prev = stageMap.get(key) || { stage: key, dealCount: 0, totalValue: 0 };
      prev.dealCount += 1;
      prev.totalValue += itemValue;
      stageMap.set(key, prev);
    });
    return Array.from(stageMap.values());
  }, [filteredPipelineRecords]);

  const memberDealSections = useMemo(
    () => [
      { key: "open", label: "Open Deals", rows: memberDetailData.deals?.open || [] },
      { key: "won", label: "Won Deals", rows: memberDetailData.deals?.won || [] },
      { key: "lost", label: "Lost Deals", rows: memberDetailData.deals?.lost || [] }
    ],
    [memberDetailData.deals]
  );

  const hasMemberDeals = useMemo(
    () => memberDealSections.some((section) => section.rows.length),
    [memberDealSections]
  );

  const memberDealsFlat = useMemo(
    () =>
      memberDealSections.flatMap((section) =>
        section.rows.map((deal) => ({
          ...deal,
          dealStatus: section.key
        }))
      ),
    [memberDealSections]
  );

  const memberDealStageOptions = useMemo(
    () => [...new Set(memberDealsFlat.map((deal) => deal.stage).filter(Boolean))],
    [memberDealsFlat]
  );

  const filteredMemberDeals = useMemo(() => {
    const query = memberDealFilters.query.trim().toLowerCase();
    return memberDealsFlat.filter((deal) => {
      const statusOk = memberDealFilters.status === "all" || deal.dealStatus === memberDealFilters.status;
      const stageOk = memberDealFilters.stage === "all" || (deal.stage || "") === memberDealFilters.stage;
      if (!statusOk || !stageOk) return false;
      if (!query) return true;

      const haystack = [deal._id, deal.companyName, deal.stage, deal.dealStatus]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [memberDealsFlat, memberDealFilters]);

  const memberFollowupEntityOptions = useMemo(
    () => [...new Set(memberDetailData.followups.map((f) => f.entityType).filter(Boolean))],
    [memberDetailData.followups]
  );

  const filteredMemberFollowups = useMemo(() => {
    const query = memberFollowupFilters.query.trim().toLowerCase();
    return (memberDetailData.followups || []).filter((followup) => {
      const statusValue = followup.isCompleted ? "completed" : "pending";
      const statusOk = memberFollowupFilters.status === "all" || statusValue === memberFollowupFilters.status;
      const typeOk =
        memberFollowupFilters.entityType === "all" ||
        (followup.entityType || "") === memberFollowupFilters.entityType;
      if (!statusOk || !typeOk) return false;
      if (!query) return true;

      const haystack = [
        followup.title,
        followup.companyName,
        followup.actionType,
        followup.kind,
        followup.entityType
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [memberDetailData.followups, memberFollowupFilters]);

  const memberLeadStatusOptions = useMemo(
    () => [...new Set((memberDetailData.leads || []).map((lead) => lead.status).filter(Boolean))],
    [memberDetailData.leads]
  );
  const memberLeadTemperatureOptions = useMemo(
    () =>
      [...new Set((memberDetailData.leads || []).map((lead) => lead.temperature).filter(Boolean))],
    [memberDetailData.leads]
  );
  const filteredMemberLeads = useMemo(() => {
    const query = memberLeadFilters.query.trim().toLowerCase();
    return (memberDetailData.leads || []).filter((lead) => {
      const statusOk =
        memberLeadFilters.status === "all" || (lead.status || "") === memberLeadFilters.status;
      const temperatureOk =
        memberLeadFilters.temperature === "all" ||
        (lead.temperature || "") === memberLeadFilters.temperature;
      if (!statusOk || !temperatureOk) return false;
      if (!query) return true;

      const haystack = [
        lead._id,
        lead.companyName,
        lead.status,
        lead.temperature,
        lead.nextAction
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [memberDetailData.leads, memberLeadFilters]);

  const pipelineCardData = useMemo(() => {
    const fallbackDealStages = Array.isArray(dashboardData.stageDistribution)
      ? dashboardData.stageDistribution.map((row) => ({
          stage: row.stage,
          count: Number(row.count || 0),
          value: 0
        }))
      : [];

    const leadStages = Array.isArray(dashboardData.pipeline?.lead?.stages)
      ? dashboardData.pipeline.lead.stages
      : [];
    const dealStages = Array.isArray(dashboardData.pipeline?.deal?.stages)
      ? dashboardData.pipeline.deal.stages
      : fallbackDealStages;

    return {
      lead: {
        totals: dashboardData.pipeline?.lead?.totals || { count: 0, value: 0 },
        stages: leadStages
      },
      deal: {
        totals: dashboardData.pipeline?.deal?.totals || {
          count: Number(dashboardData.kpis?.activeDeals || 0),
          value: Number(dashboardData.kpis?.pipelineValue || 0)
        },
        stages: dealStages
      }
    };
  }, [dashboardData.pipeline, dashboardData.stageDistribution, dashboardData.kpis]);

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
              onClick={() => navigate(assignTargetsPath)}
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
                    <th>Leads</th>
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
                        <td>{row.totalLeads || 0}</td>
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
                      <td colSpan={8} className="team-table-empty">
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
              <small>{activeFollowupRows.length}</small>
            </div>
            <div className="team-toggle-row">
              <button
                type="button"
                className={`team-toggle-btn ${followupViewType === "lead" ? "active" : ""}`}
                onClick={() => setFollowupViewType("lead")}
              >
                Leads
              </button>
              <button
                type="button"
                className={`team-toggle-btn ${followupViewType === "deal" ? "active" : ""}`}
                onClick={() => setFollowupViewType("deal")}
              >
                Deals
              </button>
            </div>
            <div className="team-followups-list">
              {paginatedFollowups.length ? (
                paginatedFollowups.map((followup) => (
                  <div key={followup._id} className="team-followup-row">
                    <div className="team-followup-main">
                      <strong title={followup.companyName}>{followup.companyName}</strong>
                      <p title={followup.title || followup.notes || "No note"}>
                        {followup.title || followup.notes || "No note"}
                      </p>
                      <span title={`Assigned To: ${followup.assignedTo?.name || "Unassigned"} | Stage: ${followup.stage || "-"}`}>
                        Assigned To: {followup.assignedTo?.name || "Unassigned"} | Stage:{" "}
                        {followup.stage || "-"}
                      </span>
                    </div>
                    <div className="team-followup-side">
                      <div className="team-followup-time">{formatDateTime(followup.dueDateTime)}</div>
                      <span
                        className={`team-member-pill ${
                          followup.isCompleted ? "team-member-pill-completed" : "team-member-pill-pending"
                        }`}
                      >
                        {followup.status || "pending"}
                      </span>
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
                <div className="team-muted">No {followupViewType} follow-ups due today</div>
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
              <button
                className="team-inline-view-btn"
                onClick={() => openPipelineDetail(pipelineViewType)}
              >
                View
              </button>
            </div>
            <div className="team-toggle-row">
              <button
                type="button"
                className={`team-toggle-btn ${pipelineViewType === "deal" ? "active" : ""}`}
                onClick={() => setPipelineViewType("deal")}
              >
                Deals
              </button>
              <button
                type="button"
                className={`team-toggle-btn ${pipelineViewType === "lead" ? "active" : ""}`}
                onClick={() => setPipelineViewType("lead")}
              >
                Leads
              </button>
            </div>
            <div className="team-stage-list">
              {(pipelineCardData[pipelineViewType]?.stages || []).length ? (
                (pipelineCardData[pipelineViewType]?.stages || []).map((item) => (
                  <div key={item.stage} className="team-stage-row">
                    <span>{item.stage}</span>
                    <div className="team-stage-bar">
                      <span
                        style={{
                          width: `${
                            (pipelineCardData[pipelineViewType]?.totals?.count || 0)
                              ? Math.max(
                                  6,
                                  Math.round(
                                    ((Number(item.count || 0) || 0) /
                                      (pipelineCardData[pipelineViewType]?.totals?.count || 1)) *
                                      100
                                  )
                                )
                              : 0
                          }%`
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
              <div className="team-toggle-row">
                <button
                  type="button"
                  className={`team-toggle-btn ${pipelineDetailType === "deal" ? "active" : ""}`}
                  onClick={() => switchPipelineDetailType("deal")}
                >
                  Deal Pipeline
                </button>
                <button
                  type="button"
                  className={`team-toggle-btn ${pipelineDetailType === "lead" ? "active" : ""}`}
                  onClick={() => switchPipelineDetailType("lead")}
                >
                  Lead Pipeline
                </button>
              </div>
              <div className="team-modal-summary-grid">
                <article className="team-modal-summary-item">
                  <span className="team-modal-label">Team</span>
                  <strong className="team-modal-value">{selectedTeam?.name || "-"}</strong>
                </article>
                <article className="team-modal-summary-item">
                  <span className="team-modal-label">
                    {pipelineDetailType === "deal" ? "Active Deals" : "Active Leads"}
                  </span>
                  <strong className="team-modal-value">{pipelineDetailData.totals.count || 0}</strong>
                </article>
                <article className="team-modal-summary-item">
                  <span className="team-modal-label">
                    {pipelineDetailType === "deal" ? "Pipeline Value" : "Estimated Value"}
                  </span>
                  <strong className="team-modal-value">
                    {formatCurrency(pipelineDetailData.totals.value || 0)}
                  </strong>
                </article>
                <article className="team-modal-summary-item">
                  <span className="team-modal-label">
                    {pipelineDetailType === "deal" ? "Win Rate" : "Lead Share"}
                  </span>
                  <strong className="team-modal-value">
                    {pipelineDetailType === "deal"
                      ? `${dashboardData.kpis.winRate || 0}%`
                      : `${Math.max(
                          0,
                          Math.min(
                            100,
                            Math.round(
                              ((pipelineDetailData.totals.count || 0) /
                                Math.max(1, Number(dashboardData.kpis?.totalLeads || 0))) *
                                100
                            )
                          )
                        )}%`}
                  </strong>
                </article>
              </div>

              {pipelineDetailLoading ? (
                <div className="team-muted">Loading pipeline details...</div>
              ) : null}

              {!pipelineDetailLoading && pipelineDetailError ? (
                <div className="team-modal-error">{pipelineDetailError}</div>
              ) : null}

              {!pipelineDetailLoading && !pipelineDetailError ? (
                <>
                  <div className="team-modal-filters">
                    <input
                      type="text"
                      className="team-modal-filter-input"
                      placeholder={
                        pipelineDetailType === "deal"
                          ? "Search by deal, company or owner..."
                          : "Search by lead, company, action or owner..."
                      }
                      value={pipelineFilters.query}
                      onChange={(e) =>
                        setPipelineFilters((prev) => ({
                          ...prev,
                          query: e.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="team-modal-tabs" role="tablist" aria-label="Pipeline stage tabs">
                    <button
                      type="button"
                      className={`team-modal-tab-btn ${pipelineFilters.stage === "all" ? "active" : ""}`}
                      onClick={() =>
                        setPipelineFilters((prev) => ({
                          ...prev,
                          stage: "all"
                        }))
                      }
                    >
                      All Stages
                    </button>
                    {pipelineStageOptions.map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        className={`team-modal-tab-btn ${pipelineFilters.stage === stage ? "active" : ""}`}
                        onClick={() =>
                          setPipelineFilters((prev) => ({
                            ...prev,
                            stage
                          }))
                        }
                      >
                        {stage}
                      </button>
                    ))}
                  </div>

                  {filteredPipelineStageSummary.length ? (
                    <div className="team-modal-table-wrap">
                      <table className="team-modal-table">
                        <thead>
                          <tr>
                            <th>Stage</th>
                            <th>{pipelineDetailType === "deal" ? "Deals" : "Leads"}</th>
                            <th>{pipelineDetailType === "deal" ? "Pipeline Value" : "Estimated Value"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPipelineStageSummary.map((stage) => (
                            <tr key={stage.stage}>
                              <td>{stage.stage}</td>
                              <td>{stage.dealCount}</td>
                              <td>{formatCurrency(stage.totalValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="team-muted">No active stage data</div>
                  )}

                  {filteredPipelineRecords.length ? (
                    <div className="team-modal-table-wrap">
                      <table className="team-modal-table">
                        <thead>
                          {pipelineDetailType === "deal" ? (
                            <tr>
                              <th>Stage</th>
                              <th>Company</th>
                              <th>Owner</th>
                              <th>Value</th>
                              <th>Probability</th>
                              <th>Expected Close</th>
                            </tr>
                          ) : (
                            <tr>
                              <th>Stage</th>
                              <th>Company</th>
                              <th>Owner</th>
                              <th>Estimated Value</th>
                              <th>Action</th>
                              <th>Due</th>
                              <th>View</th>
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {filteredPipelineRecords.map((item) =>
                            pipelineDetailType === "deal" ? (
                              <tr key={`${item._id}-${item.stageLabel}`}>
                                <td>{item.stageLabel || "-"}</td>
                                <td title={item.companyName}>{item.companyName || "-"}</td>
                                <td title={item.assignedTo?.email || ""}>
                                  {item.assignedTo?.name || "Unassigned"}
                                </td>
                                <td>{formatCurrency(item.dealValue || 0)}</td>
                                <td>{Number(item.probability) || 0}%</td>
                                <td>{formatDate(item.expectedCloseDate)}</td>
                              </tr>
                            ) : (
                              <tr key={`${item._id}-${item.stageLabel}`}>
                                <td>{item.stageLabel || "-"}</td>
                                <td title={item.companyName}>{item.companyName || "-"}</td>
                                <td title={item.assignedTo?.email || ""}>
                                  {item.assignedTo?.name || "Unassigned"}
                                </td>
                                <td>{formatCurrency(item.estimatedValue || 0)}</td>
                                <td>{item.actionType || item.title || "-"}</td>
                                <td>{formatDate(item.dueDateTime)}</td>
                                <td>
                                  <button
                                    className="team-inline-view-btn"
                                    onClick={() => item.leadId && navigate(`/leads/${item.leadId}`)}
                                    disabled={!item.leadId}
                                  >
                                    View
                                  </button>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="team-muted">
                      No {pipelineDetailType} pipeline records match current filters.
                    </div>
                  )}
                </>
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
                  className={memberDetailTab === "leads" ? "active" : ""}
                  onClick={() => setMemberDetailTab("leads")}
                >
                  Leads
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
                <>
                  <div className="team-modal-filters">
                        <input
                          type="text"
                          className="team-modal-filter-input"
                          placeholder="Search by company or stage..."
                          value={memberDealFilters.query}
                          onChange={(e) =>
                            setMemberDealFilters((prev) => ({
                          ...prev,
                          query: e.target.value
                        }))
                      }
                    />
                    <select
                      className="team-modal-filter-select"
                      value={memberDealFilters.stage}
                      onChange={(e) =>
                        setMemberDealFilters((prev) => ({
                          ...prev,
                          stage: e.target.value
                        }))
                      }
                    >
                      <option value="all">All Stages</option>
                      {memberDealStageOptions.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="team-modal-tabs" role="tablist" aria-label="Member deal status tabs">
                    {[
                      { key: "all", label: "All" },
                      { key: "open", label: "Open" },
                      { key: "won", label: "Won" },
                      { key: "lost", label: "Lost" }
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`team-modal-tab-btn ${
                          memberDealFilters.status === tab.key ? "active" : ""
                        }`}
                        onClick={() =>
                          setMemberDealFilters((prev) => ({
                            ...prev,
                            status: tab.key
                          }))
                        }
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {hasMemberDeals ? (
                    <div className="team-modal-table-wrap">
                      <table className="team-modal-table team-modal-table-compact">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Company</th>
                            <th>Stage</th>
                            <th>Value</th>
                            <th>Expected Close</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMemberDeals.length ? (
                            filteredMemberDeals.map((deal) => (
                              <tr key={`${deal._id}-${deal.dealStatus}`}>
                                <td>
                                  <span className="team-member-pill">
                                    {deal.dealStatus?.toUpperCase() || "-"}
                                  </span>
                                </td>
                                <td title={deal.companyName}>{deal.companyName || "-"}</td>
                                <td>{deal.stage || "-"}</td>
                                <td>{formatCurrency(deal.dealValue || 0)}</td>
                                <td>{formatDate(deal.expectedCloseDate)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="team-table-empty">
                                No deals match current filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="team-muted">No deals found for this member.</div>
                  )}
                </>
              ) : null}

              {!memberDetailLoading && !memberDetailError && memberDetailTab === "leads" ? (
                <section className="team-member-section">
                  <div className="team-member-section-head">
                    <h4>Lead Details</h4>
                    <small>{memberDetailData.leadSummary?.total || 0}</small>
                  </div>

                  <div className="team-member-lead-summary">
                    <span>New: {memberDetailData.leadSummary?.new || 0}</span>
                    <span>Contacted: {memberDetailData.leadSummary?.contacted || 0}</span>
                    <span>Qualified: {memberDetailData.leadSummary?.qualified || 0}</span>
                    <span>Rejected: {memberDetailData.leadSummary?.rejected || 0}</span>
                  </div>

                  {memberDetailData.leads.length ? (
                    <div className="team-member-sections">
                      <div className="team-modal-filters">
                        <input
                          type="text"
                          className="team-modal-filter-input"
                          placeholder="Search by lead, status or next action..."
                          value={memberLeadFilters.query}
                          onChange={(e) =>
                            setMemberLeadFilters((prev) => ({
                              ...prev,
                              query: e.target.value
                            }))
                          }
                        />
                        <select
                          className="team-modal-filter-select"
                          value={memberLeadFilters.status}
                          onChange={(e) =>
                            setMemberLeadFilters((prev) => ({
                              ...prev,
                              status: e.target.value
                            }))
                          }
                        >
                          <option value="all">All Statuses</option>
                          {memberLeadStatusOptions.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <select
                          className="team-modal-filter-select"
                          value={memberLeadFilters.temperature}
                          onChange={(e) =>
                            setMemberLeadFilters((prev) => ({
                              ...prev,
                              temperature: e.target.value
                            }))
                          }
                        >
                          <option value="all">All Temperatures</option>
                          {memberLeadTemperatureOptions.map((temp) => (
                            <option key={temp} value={temp}>
                              {temp}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="team-modal-table-wrap">
                        <table className="team-modal-table team-modal-table-compact">
                          <thead>
                            <tr>
                              <th>Company</th>
                              <th>Status</th>
                              <th>Temperature</th>
                              <th>Estimated Value</th>
                              <th>Last Contact</th>
                              <th>Next Action</th>
                              <th>View</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMemberLeads.length ? (
                              filteredMemberLeads.map((lead) => (
                                <tr key={lead._id}>
                                  <td title={lead.companyName}>{lead.companyName || "-"}</td>
                                  <td>{lead.status || "-"}</td>
                                  <td>{lead.temperature || "-"}</td>
                                  <td>{formatCurrency(lead.estimatedValue || 0)}</td>
                                  <td>{formatDateTime(lead.lastContactDate)}</td>
                                  <td title={lead.nextAction}>{lead.nextAction || "-"}</td>
                                  <td>
                                    <button
                                      className="team-inline-view-btn"
                                      onClick={() => lead._id && navigate(`/leads/${lead._id}`)}
                                      disabled={!lead._id}
                                    >
                                      View
                                    </button>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={8} className="team-table-empty">
                                  No leads match current filters.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="team-muted">No leads found for this member.</div>
                  )}
                </section>
              ) : null}

              {!memberDetailLoading && !memberDetailError && memberDetailTab === "followups" ? (
                <section className="team-member-section">
                  <div className="team-member-section-head">
                    <h4>Follow-ups for Today</h4>
                    <small>{memberDetailData.followups.length}</small>
                  </div>
                  {memberDetailData.followups.length ? (
                    <div className="team-member-sections">
                      <div className="team-modal-filters">
                        <input
                          type="text"
                          className="team-modal-filter-input"
                          placeholder="Search by title, company or type..."
                          value={memberFollowupFilters.query}
                          onChange={(e) =>
                            setMemberFollowupFilters((prev) => ({
                              ...prev,
                              query: e.target.value
                            }))
                          }
                        />
                        <select
                          className="team-modal-filter-select"
                          value={memberFollowupFilters.entityType}
                          onChange={(e) =>
                            setMemberFollowupFilters((prev) => ({
                              ...prev,
                              entityType: e.target.value
                            }))
                          }
                        >
                          <option value="all">All Linked Types</option>
                          {memberFollowupEntityOptions.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="team-modal-tabs" role="tablist" aria-label="Follow-up status tabs">
                        {[
                          { key: "all", label: "All" },
                          { key: "pending", label: "Pending" },
                          { key: "completed", label: "Completed" }
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            className={`team-modal-tab-btn ${
                              memberFollowupFilters.status === tab.key ? "active" : ""
                            }`}
                            onClick={() =>
                              setMemberFollowupFilters((prev) => ({
                                ...prev,
                                status: tab.key
                              }))
                            }
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="team-modal-table-wrap">
                        <table className="team-modal-table team-modal-table-compact">
                          <thead>
                            <tr>
                              <th>Title</th>
                              <th>Company</th>
                              <th>Type</th>
                              <th>Linked To</th>
                              <th>Due</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMemberFollowups.length ? (
                              filteredMemberFollowups.map((followup) => (
                                <tr key={followup._id}>
                                  <td title={followup.title}>{followup.title || "-"}</td>
                                  <td title={followup.companyName}>{followup.companyName || "-"}</td>
                                  <td>{followup.actionType || followup.kind || "-"}</td>
                                  <td>{followup.entityType || "-"}</td>
                                  <td>{formatDateTime(followup.dueDateTime)}</td>
                                  <td>
                                    <span
                                      className={`team-member-pill ${
                                        followup.isCompleted
                                          ? "team-member-pill-completed"
                                          : "team-member-pill-pending"
                                      }`}
                                    >
                                      {followup.isCompleted ? "Completed" : "Pending"}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="team-table-empty">
                                  No follow-ups match current filters.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
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
                  <span className="team-modal-label">Entity</span>
                  <strong className="team-modal-value">{selectedFollowupRow.entityType || "-"}</strong>
                </div>
                <div>
                  <span className="team-modal-label">Due</span>
                  <strong className="team-modal-value">
                    {formatDateTime(selectedFollowupRow.dueDateTime)}
                  </strong>
                </div>
              </div>

              <div className="team-modal-section">
                <h4>Task</h4>
                <p className="team-modal-text">{selectedFollowupRow.title || "-"}</p>
              </div>

              <div className="team-modal-section">
                <h4>Details</h4>
                <p className="team-modal-text">
                  Action: {selectedFollowupRow.actionType || "-"} | Stage: {selectedFollowupRow.stage || "-"} |
                  {" "}Status: {selectedFollowupRow.status || "-"}
                </p>
                <p className="team-modal-text">{selectedFollowupRow.notes || "No additional notes."}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
