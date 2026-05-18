import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import API from "../../api";

const emptyState = {
  insights: {
    plainSummary: "",
    summary: "",
    todayPriorities: [],
    keyMetrics: [],
    opportunities: [],
    warnings: [],
    coachTip: "",
    weekOutlook: "",
  },
  evidence: {
    scope: "personal",
    metrics: {},
    memberPerformance: [],
    recentLeads: [],
    stageBreakdown: [],
    teamName: "",
    managerName: "",
    memberCount: 0,
  },
  generatedAt: "",
  mode: "personal",
  teamName: "",
};

const shimmerKeyframes = `
  @keyframes aiInsightsShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

function normalizeRole(rawRole = "") {
  const role = String(rawRole || "").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "user";
}

function normalizeFilter(rawFilter = "") {
  const filter = String(rawFilter || "").trim().toLowerCase();
  if (filter === "week" || filter === "quarter") return filter;
  return "month";
}

function getFilterLabel(filter = "month") {
  if (filter === "week") return "This Week";
  if (filter === "quarter") return "This Quarter";
  return "This Month";
}

function formatTimestamp(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function trendMeta(value) {
  const trend = String(value || "").toLowerCase();
  if (trend === "up") return { icon: "↑", color: "#15803d" };
  if (trend === "down") return { icon: "↓", color: "#dc2626" };
  return { icon: "→", color: "#6b7280" };
}

function urgencyMeta(value) {
  const urgency = String(value || "").toLowerCase();
  if (urgency === "high") {
    return { border: "#dc2626", background: "#fef2f2", color: "#991b1b" };
  }
  if (urgency === "low") {
    return { border: "#16a34a", background: "#f0fdf4", color: "#166534" };
  }
  return { border: "#d97706", background: "#fffbeb", color: "#92400e" };
}

function warningMeta(value) {
  const severity = String(value || "").toLowerCase();
  if (severity === "critical") {
    return { icon: "🚨", background: "#fee2e2", color: "#991b1b", border: "#fca5a5" };
  }
  if (severity === "warning") {
    return { icon: "⚠️", background: "#fef3c7", color: "#92400e", border: "#fcd34d" };
  }
  return { icon: "ℹ️", background: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" };
}

function impactMeta(value) {
  const impact = String(value || "").toLowerCase();
  if (impact === "high") return { background: "#fee2e2", color: "#991b1b" };
  if (impact === "low") return { background: "#dcfce7", color: "#166534" };
  return { background: "#fef3c7", color: "#92400e" };
}

function getBadge(role, mode, teamName) {
  if (mode === "company") {
    return { label: "Company View", color: "#6d28d9", background: "#ede9fe" };
  }
  if (mode === "team") {
    return { label: `Team: ${teamName || "Selected Team"}`, color: "#1d4ed8", background: "#dbeafe" };
  }
  if (role === "admin") {
    return { label: "Company Overview", color: "#6d28d9", background: "#ede9fe" };
  }
  if (role === "manager") {
    return { label: "My Personal View", color: "#0f766e", background: "#ccfbf1" };
  }
  return { label: "My View", color: "#0f766e", background: "#ccfbf1" };
}

function buildGlanceMetrics(mode, metrics, activeFilter = "month") {
  const periodSubtitle = getFilterLabel(activeFilter);
  const currentSubtitle = "Current";
  const items = [
    { label: "Active Leads", value: metrics.totalLeads, subtitle: currentSubtitle },
    { label: "New Leads", value: metrics.newLeads, subtitle: periodSubtitle },
    { label: "Converted", value: metrics.convertedLeads, subtitle: periodSubtitle },
    { label: "Open Deals", value: metrics.openDeals, subtitle: currentSubtitle },
    { label: "Won Deals", value: metrics.wonDeals, subtitle: periodSubtitle },
    { label: "Lost Deals", value: metrics.lostDeals, subtitle: periodSubtitle },
    { label: "Pipeline Value", value: formatCurrency(metrics.pipelineValue), subtitle: currentSubtitle, isCurrency: true },
    { label: "Total Clients", value: metrics.totalClients, subtitle: currentSubtitle },
    { label: "Pending Follow-ups", value: metrics.pendingFollowUps, subtitle: currentSubtitle },
    { label: "Overdue", value: metrics.overdueFollowUps, subtitle: currentSubtitle },
    { label: "Pending Expenses", value: metrics.pendingExpenses, subtitle: currentSubtitle },
  ];

  if (mode === "company") {
    items.push({ label: "Total Users", value: metrics.totalUsers, subtitle: currentSubtitle });
  }

  return items;
}

function SkeletonBlock({ height, style = {} }) {
  return (
    <div
      style={{
        height,
        borderRadius: 12,
        background: "linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%)",
        backgroundSize: "200% 100%",
        animation: "aiInsightsShimmer 1.6s linear infinite",
        ...style,
      }}
    />
  );
}

function LoadingView() {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <SkeletonBlock height={96} />
      <SkeletonBlock height={150} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonBlock key={index} height={118} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        <SkeletonBlock height={260} />
        <SkeletonBlock height={260} />
      </div>
      <SkeletonBlock height={200} />
      <SkeletonBlock height={240} />
      <SkeletonBlock height={100} />
    </div>
  );
}

export default function AIInsights() {
  const location = useLocation();
  const [insightData, setInsightData] = useState(emptyState);
  const [glanceData, setGlanceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [glanceLoading, setGlanceLoading] = useState(false);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [loadingTeamOptions, setLoadingTeamOptions] = useState(false);
  const [dateFilter, setDateFilter] = useState("month");

  const role = useMemo(
    () => normalizeRole(localStorage.getItem("role") || localStorage.getItem("RoleName") || "user"),
    []
  );
  const userName = useMemo(
    () => localStorage.getItem("name") || localStorage.getItem("Name") || "there",
    []
  );

  const searchParams = new URLSearchParams(location.search);
  const urlTeamId = searchParams.get("teamId");
  const badge = getBadge(role, insightData.mode || "personal", insightData.teamName || insightData.evidence?.teamName);

  const buildApiUrl = (teamId, glanceFilter) => {
    const params = new URLSearchParams();
    if (teamId === "all") {
      params.set("teamId", "all");
    } else if (teamId) {
      params.set("teamId", teamId);
    }
    if (glanceFilter) {
      params.set("glanceFilter", glanceFilter);
    }
    const query = params.toString();
    return query ? `/api/ai-insights?${query}` : "/api/ai-insights";
  };

  const fetchInsightsData = async (overrideTeamId = null) => {
    const effectiveTeamId = overrideTeamId ?? urlTeamId;
    const apiUrl = buildApiUrl(effectiveTeamId, "");
    console.log("[AI Insights Frontend] calling insights:", apiUrl);
    const token = localStorage.getItem("token");
    const res = await API.get(apiUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.data;
  };

  const fetchGlanceData = async (overrideTeamId = null, overrideFilter = dateFilter) => {
    const effectiveTeamId = overrideTeamId ?? urlTeamId;
    const apiUrl = buildApiUrl(effectiveTeamId, overrideFilter);
    console.log("[AI Insights Frontend] calling glance:", apiUrl);
    const token = localStorage.getItem("token");
    const res = await API.get(apiUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.data;
  };

  const fetchTeamsFallback = async () => {
    const token = localStorage.getItem("token");
    const res = await API.get("/teams", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const rows = Array.isArray(res.data) ? res.data : [];
    return rows.map((team) => ({
      _id: String(team?._id || ""),
      name: team?.name || "Unnamed Team",
      managerName:
        team?.teamLeads?.[0]?.userId?.name ||
        team?.managerName ||
        "",
      memberCount: Number(team?.totalPeople || team?.memberCount || 0),
    })).filter((team) => team._id);
  };

  const loadGlanceOnly = async (overrideTeamId = null, overrideFilter = dateFilter) => {
    try {
      setGlanceLoading(true);
      const effectiveTeamId = overrideTeamId ?? (urlTeamId === "all" && selectedTeamId ? selectedTeamId : urlTeamId);
      const response = await fetchGlanceData(effectiveTeamId, overrideFilter);
      setGlanceData(response?.glanceMetrics ? { ...response.glanceMetrics, activeFilter: response.activeFilter } : null);
    } catch (err) {
      console.error("[AI Insights Frontend] glance refresh failed:", err?.response?.data?.message || err?.message || err);
    } finally {
      setGlanceLoading(false);
    }
  };

  const loadInsights = async (overrideTeamId = null) => {
    try {
      setLoading(true);
      setError("");
      const effectiveTeamId = overrideTeamId ?? (urlTeamId === "all" && selectedTeamId ? selectedTeamId : urlTeamId);

      if ((overrideTeamId === "all" || (urlTeamId === "all" && !selectedTeamId)) && role === "admin") {
        setLoadingTeamOptions(true);
        const teamListResponse = await fetchInsightsData("all");
        let rows = Array.isArray(teamListResponse?.teams) ? teamListResponse.teams : [];

        if (!rows.length) {
          console.warn("[AI Insights Frontend] empty teamList from /api/ai-insights?teamId=all, falling back to /teams");
          rows = await fetchTeamsFallback();
        }

        setTeams(rows);
        setLoadingTeamOptions(false);

        if (!rows.length) {
          throw new Error("No teams available for AI insights.");
        }

        const nextTeamId = overrideTeamId && overrideTeamId !== "all"
          ? String(overrideTeamId)
          : selectedTeamId && rows.some((team) => String(team._id) === String(selectedTeamId))
          ? selectedTeamId
          : String(rows[0]._id);

        setSelectedTeamId(nextTeamId);
        const [teamResponse, teamGlanceResponse] = await Promise.all([
          fetchInsightsData(nextTeamId),
          fetchGlanceData(nextTeamId, dateFilter),
        ]);
        setInsightData(teamResponse || emptyState);
        setGlanceData(teamGlanceResponse?.glanceMetrics ? { ...teamGlanceResponse.glanceMetrics, activeFilter: teamGlanceResponse.activeFilter } : null);
        return;
      }

      if (effectiveTeamId) {
        setSelectedTeamId(String(effectiveTeamId));
        const [response, glanceResponse] = await Promise.all([
          fetchInsightsData(effectiveTeamId),
          fetchGlanceData(effectiveTeamId, dateFilter),
        ]);
        setInsightData(response || emptyState);
        setGlanceData(glanceResponse?.glanceMetrics ? { ...glanceResponse.glanceMetrics, activeFilter: glanceResponse.activeFilter } : null);
        return;
      }

      setTeams([]);
      setSelectedTeamId("");
      const [response, glanceResponse] = await Promise.all([
        fetchInsightsData(null),
        fetchGlanceData(null, dateFilter),
      ]);
      setInsightData(response || emptyState);
      setGlanceData(glanceResponse?.glanceMetrics ? { ...glanceResponse.glanceMetrics, activeFilter: glanceResponse.activeFilter } : null);
    } catch (err) {
      setLoadingTeamOptions(false);
      setError(err?.response?.data?.message || err?.message || "Failed to load AI insights.");
      setInsightData(emptyState);
      setGlanceData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (urlTeamId === "all" && !selectedTeamId) {
      loadInsights("all");
      return;
    }
    loadInsights(urlTeamId === "all" ? selectedTeamId : urlTeamId || null);
  }, [urlTeamId, selectedTeamId]);

  useEffect(() => {
    if (loading) return;
    loadGlanceOnly(urlTeamId === "all" ? selectedTeamId : urlTeamId || null, dateFilter);
  }, [dateFilter]);

  const onRefresh = () => {
    loadInsights(urlTeamId === "all" ? selectedTeamId : urlTeamId || null);
  };

  const onChangeTeam = (nextTeamId) => {
    setSelectedTeamId(nextTeamId);
  };

  const insights = insightData.insights || emptyState.insights;
  const evidence = insightData.evidence || emptyState.evidence;
  const activeFilter = normalizeFilter(glanceData?.activeFilter || dateFilter);
  const activeFilterLabel = getFilterLabel(activeFilter);
  const glanceMetrics = buildGlanceMetrics(insightData.mode || "personal", glanceData || {}, activeFilter);
  const showTeamSelector = role === "admin" && urlTeamId === "all";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #eff6ff 0%, #f8fafc 45%, #ffffff 100%)",
        padding: "24px 16px 40px",
        fontFamily: "system-ui, Segoe UI, sans-serif",
        color: "#0f172a",
      }}
    >
      <style>{shimmerKeyframes}</style>

      <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 20 }}>
        <section
          style={{
            background: "#ffffff",
            borderRadius: 16,
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            padding: 24,
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1 }}>🤖 AI Insights</h1>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  color: badge.color,
                  background: badge.background,
                }}
              >
                {badge.label}
              </span>
            </div>
            <div style={{ fontSize: 17, color: "#334155" }}>
              Hey {userName} — here&apos;s what your CRM tells you right now
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Last updated: {formatTimestamp(insightData.generatedAt)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {showTeamSelector ? (
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  Select Team
                </label>
                <select
                  value={selectedTeamId}
                  onChange={(e) => onChangeTeam(e.target.value)}
                  disabled={loadingTeamOptions || loading}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "11px 14px",
                    minWidth: 220,
                    fontSize: 14,
                    background: "#ffffff",
                  }}
                >
                  {teams.map((team) => (
                    <option key={team._id} value={team._id}>
                      {team.name || "Unnamed Team"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 12,
                background: "#2563eb",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 700,
                padding: "12px 18px",
                cursor: loading ? "wait" : "pointer",
                boxShadow: "0 8px 18px rgba(37, 99, 235, 0.28)",
              }}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        {error && !loading ? (
          <div style={{ minHeight: 320, display: "grid", placeItems: "center" }}>
            <div
              style={{
                width: "100%",
                maxWidth: 560,
                background: "#fee2e2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                borderRadius: 16,
                boxShadow: "0 10px 30px rgba(127, 29, 29, 0.12)",
                padding: 28,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>Something went wrong</div>
              <div style={{ fontSize: 15, marginBottom: 18 }}>{error}</div>
              <button
                type="button"
                onClick={onRefresh}
                style={{
                  border: "none",
                  borderRadius: 12,
                  background: "#dc2626",
                  color: "#ffffff",
                  padding: "11px 18px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <LoadingView />
        ) : !error ? (
          <>
            <section
              style={{
                background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
                color: "#ffffff",
                borderRadius: 18,
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.18)",
                padding: 24,
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 13, letterSpacing: "0.12em" }}>
                <span style={{ fontSize: 22 }}>🤖</span>
                <span style={{ opacity: 0.86 }}>AI SUMMARY</span>
              </div>
              {insights.plainSummary ? (
                <div
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    border: "1px solid rgba(191, 219, 254, 0.25)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    fontSize: 16,
                    fontWeight: 800,
                    lineHeight: 1.45,
                    maxWidth: 980,
                  }}
                >
                  Plain-language Summary: {insights.plainSummary}
                </div>
              ) : null}
              <div style={{ fontSize: 18, lineHeight: 1.7, maxWidth: 980 }}>{insights.summary}</div>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#bfdbfe", textTransform: "uppercase" }}>
                  Future Outlook
                </div>
                <div style={{ fontSize: 15, fontStyle: "italic", color: "#bfdbfe" }}>{insights.weekOutlook}</div>
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 16,
              }}
            >
              {insights.keyMetrics.map((metric, index) => {
                const trend = trendMeta(metric.trend);
                return (
                  <div
                    key={`${metric.label}-${index}`}
                    style={{
                      background: "linear-gradient(145deg, #eff6ff 0%, #dbeafe 100%)",
                      borderRadius: 14,
                      padding: 18,
                      boxShadow: "0 8px 20px rgba(37, 99, 235, 0.10)",
                      minHeight: 122,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {metric.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>
                        {typeof metric.value === "number" ? formatNumber(metric.value) : metric.value}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: trend.color }}>{trend.icon}</div>
                    </div>
                    <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>{metric.note}</div>
                  </div>
                );
              })}
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 20,
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 16,
                  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                  padding: 22,
                  display: "grid",
                  gap: 16,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800 }}>🎯 Today&apos;s Priorities</div>
                {insights.todayPriorities.length ? (
                  insights.todayPriorities.map((item, index) => {
                    const urgency = urgencyMeta(item.urgency);
                    return (
                      <div
                        key={`${item.title}-${index}`}
                        style={{
                          borderLeft: `5px solid ${urgency.border}`,
                          background: urgency.background,
                          color: "#0f172a",
                          borderRadius: 12,
                          padding: 16,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>
                            <span style={{ fontSize: 20 }}>{item.icon}</span>
                            <span>{item.title}</span>
                          </div>
                          <span
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              background: "#ffffff",
                              color: urgency.color,
                              textTransform: "capitalize",
                            }}
                          >
                            {item.urgency}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: "#334155" }}>{item.detail}</div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: 15, color: "#166534", background: "#f0fdf4", padding: 16, borderRadius: 12 }}>
                    No urgent tasks today. Great work!
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 16,
                  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                  padding: 22,
                  display: "grid",
                  gap: 16,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800 }}>🚨 Alerts &amp; Warnings</div>
                {insights.warnings.length ? (
                  insights.warnings.map((item, index) => {
                    const meta = warningMeta(item.severity);
                    return (
                      <div
                        key={`${item.title}-${index}`}
                        style={{
                          background: meta.background,
                          border: `1px solid ${meta.border}`,
                          color: meta.color,
                          borderRadius: 12,
                          padding: 16,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>
                          <span style={{ fontSize: 20 }}>{meta.icon}</span>
                          <span>{item.title}</span>
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.55 }}>{item.detail}</div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: 15, color: "#166534", background: "#f0fdf4", padding: 16, borderRadius: 12 }}>
                    No active warnings. Everything looks good!
                  </div>
                )}
              </div>
            </section>

            <section
              style={{
                background: "#ffffff",
                borderRadius: 16,
                boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                padding: 22,
                display: "grid",
                gap: 16,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800 }}>💡 Opportunities to Act On</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                {insights.opportunities.map((item, index) => {
                  const impact = impactMeta(item.impact);
                  return (
                    <div
                      key={`${item.title}-${index}`}
                      style={{
                        borderLeft: "5px solid #16a34a",
                        background: "#f8fafc",
                        borderRadius: 12,
                        padding: 16,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>
                          <span style={{ fontSize: 20 }}>💡</span>
                          <span>{item.title}</span>
                        </div>
                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            background: impact.background,
                            color: impact.color,
                          }}
                        >
                          {item.impact}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.6 }}>{item.detail}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              style={{
                background: "#ffffff",
                borderRadius: 16,
                boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                padding: 22,
                display: "grid",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800 }}>Your CRM At a Glance</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, color: "#475569", fontWeight: 700 }}>Period:</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                      { value: "week", label: "This Week" },
                      { value: "month", label: "This Month" },
                      { value: "quarter", label: "This Quarter" },
                    ].map((option) => {
                      const isActive = dateFilter === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDateFilter(option.value)}
                          disabled={glanceLoading}
                          style={{
                            border: `1px solid ${isActive ? "#2563eb" : "#cbd5e1"}`,
                            borderRadius: 999,
                            background: isActive ? "#2563eb" : "#ffffff",
                            color: isActive ? "#ffffff" : "#64748b",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "8px 12px",
                            cursor: glanceLoading ? "wait" : "pointer",
                            boxShadow: isActive ? "0 8px 18px rgba(37, 99, 235, 0.18)" : "none",
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                Period: {activeFilterLabel}
              </div>

              {insightData.mode === "team" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                  }}
                >
                  <div style={{ background: "#eff6ff", borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Team Name</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{insightData.teamName || evidence.teamName || "-"}</div>
                  </div>
                  <div style={{ background: "#eff6ff", borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Manager Name</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{evidence.managerName || "-"}</div>
                  </div>
                  <div style={{ background: "#eff6ff", borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Member Count</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{formatNumber(evidence.memberCount)}</div>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 14,
                  opacity: glanceLoading ? 0.55 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                {glanceMetrics.map((item) => {
                  const label = item.label;
                  const rawValue = item.value;
                  const overdueBox = String(label).toLowerCase().includes("overdue") && Number(rawValue || 0) > 0;
                  return (
                    <div
                      key={label}
                      style={{
                        background: overdueBox ? "#fee2e2" : "#f8fafc",
                        border: `1px solid ${overdueBox ? "#fecaca" : "#e2e8f0"}`,
                        borderRadius: 12,
                        padding: 14,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: overdueBox ? "#b91c1c" : "#0f172a" }}>
                        {item.isCurrency ? rawValue : typeof rawValue === "string" ? rawValue : formatNumber(rawValue)}
                      </div>
                      <div style={{ fontSize: 12, color: overdueBox ? "#b91c1c" : "#64748b" }}>
                        {item.subtitle}
                      </div>
                    </div>
                  );
                })}
              </div>

              {insightData.mode === "team" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>Team Leaderboard</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                          <th style={{ padding: 12, fontSize: 13, color: "#475569" }}>Name</th>
                          <th style={{ padding: 12, fontSize: 13, color: "#475569" }}>Deals Won</th>
                          <th style={{ padding: 12, fontSize: 13, color: "#475569" }}>Value Won</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(evidence.memberPerformance || []).map((member) => (
                          <tr key={member.userId || member.name} style={{ borderTop: "1px solid #e2e8f0" }}>
                            <td style={{ padding: 12, fontSize: 14 }}>{member.name || "Unknown"}</td>
                            <td style={{ padding: 12, fontSize: 14 }}>{formatNumber(member.dealsWon)}</td>
                            <td style={{ padding: 12, fontSize: 14 }}>{formatCurrency(member.valueWon)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>

            <section
              style={{
                background: "linear-gradient(135deg, #dcfce7 0%, #ecfccb 100%)",
                borderRadius: 16,
                boxShadow: "0 10px 30px rgba(34, 197, 94, 0.10)",
                padding: 22,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: "#166534" }}>
                <span style={{ fontSize: 22 }}>🏆</span>
                <span>COACH TIP</span>
              </div>
              <div style={{ fontSize: 17, lineHeight: 1.65, color: "#14532d" }}>{insights.coachTip}</div>
            </section>

          </>
        ) : null}
      </div>
    </div>
  );
}
