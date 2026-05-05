import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../../api";
import "./styles/AIInsights.css";

const RANGE_OPTIONS = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" }
];

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  });
}

function normalizeSeverity(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (["high", "danger", "critical", "red"].includes(normalized)) return "high";
  if (["medium", "warning", "orange", "amber"].includes(normalized)) return "medium";
  return "low";
}

function toneLabel(tone) {
  if (tone === "high") return "High Priority";
  if (tone === "medium") return "Needs Attention";
  return "Opportunity";
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildManagerInsights(payload, range) {
  const insights = Array.isArray(payload?.insights) ? payload.insights : [];
  const meetings = Array.isArray(payload?.meetings) ? payload.meetings : [];
  const followups = Array.isArray(payload?.followups) ? payload.followups : [];
  const pipelineValue = toNumber(payload?.summary?.pipelineValue);
  const revenue = toNumber(payload?.summary?.revenueAchieved ?? payload?.summary?.monthlyAchieved);
  const totalActions = meetings.length + followups.length;

  const systemInsights = [];

  if (pipelineValue > 0) {
    systemInsights.push({
      id: "pipeline-value",
      title: "Pipeline value is carrying the period",
      message: `${formatCurrency(pipelineValue)} is currently active in pipeline for ${range}. Prioritize late-stage movement to protect this value.`,
      tone: pipelineValue >= 1000000 ? "high" : "medium",
      category: "Pipeline"
    });
  }

  if (totalActions > 0) {
    systemInsights.push({
      id: "activity-load",
      title: "Execution queue is building up",
      message: `${totalActions} follow-ups and meetings are scheduled in the selected ${range} window. Clearing the highest-priority actions first should improve conversion momentum.`,
      tone: totalActions >= 8 ? "high" : "medium",
      category: "Execution"
    });
  }

  if (revenue > 0) {
    systemInsights.push({
      id: "revenue-signal",
      title: "Revenue signal is positive",
      message: `${formatCurrency(revenue)} has been captured in won revenue for the selected window. Use the same patterns to coach similar open deals.`,
      tone: "low",
      category: "Revenue"
    });
  }

  const mappedInsights = insights.map((insight, index) => ({
    id: insight.id || `dashboard-insight-${index}`,
    title: insight.type || "AI Insight",
    message: insight.message || "No summary available.",
    tone: normalizeSeverity(insight.severity),
    category: "Assistant"
  }));

  return [...mappedInsights, ...systemInsights];
}

function buildTeamInsights(payload) {
  const insights = Array.isArray(payload?.insights) ? payload.insights : [];
  const kpis = payload?.kpis || {};
  const memberPerformance = Array.isArray(payload?.memberPerformance) ? payload.memberPerformance : [];
  const topMember = memberPerformance.length
    ? [...memberPerformance].sort(
        (a, b) => Number(b?.wonRevenue || 0) - Number(a?.wonRevenue || 0) ||
          Number(b?.wonDeals || 0) - Number(a?.wonDeals || 0)
      )[0]
    : null;

  const mappedInsights = insights.map((insight, index) => ({
    id: `team-${insight.type || "insight"}-${index}`,
    title: String(insight.type || "Insight")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    message: insight.message || "No summary available.",
    tone: normalizeSeverity(insight.severity),
    category: "Team"
  }));

  const derivedInsights = [];

  if (Number(kpis.pipelineValue || 0) > 0) {
    derivedInsights.push({
      id: "team-pipeline-value",
      title: "Team pipeline needs active coverage",
      message: `${formatCurrency(kpis.pipelineValue)} is active in this team pipeline. Keep owners focused on stage movement and follow-up discipline.`,
      tone: Number(kpis.activeDeals || 0) > 0 ? "medium" : "high",
      category: "Pipeline"
    });
  }

  if (topMember?.user?.name) {
    derivedInsights.push({
      id: "team-top-member",
      title: "Strongest team benchmark",
      message: `${topMember.user.name} is leading with ${topMember.wonDeals || 0} won deal(s). Use that conversion pattern as the coaching benchmark.`,
      tone: "low",
      category: "Performance"
    });
  }

  return [...mappedInsights, ...derivedInsights];
}

function buildActionQueue(roleName, insights) {
  const topInsight = insights.find((item) => item.tone === "high") || insights[0];
  const actions = [
    {
      id: "review-priority",
      title: "Review top signal",
      description: topInsight
        ? `${topInsight.title}: ${topInsight.message}`
        : "Open the highest-priority AI recommendation and validate it with your team.",
      cta: "Open follow-ups",
      path: "/followups"
    },
    {
      id: "inspect-pipeline",
      title: "Inspect live pipeline",
      description: "Cross-check AI recommendations against current leads and deals before making outreach changes.",
      cta: "Open deals",
      path: "/deals"
    },
    {
      id: "coach-next",
      title: roleName === "admin" ? "Coach the team" : "Take the next move",
      description: roleName === "admin"
        ? "Use the strongest positive signal as a benchmark and the highest-risk signal as a coaching topic."
        : "Convert the strongest insight into an immediate follow-up, meeting, or deal progression step.",
      cta: roleName === "admin" ? "Open team dashboard" : "Open leads",
      path: roleName === "admin" ? "/team-dashboard" : "/leads"
    }
  ];

  return actions;
}

export default function AIInsights() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const scope = String(searchParams.get("scope") || "").trim().toLowerCase();
  const teamId = String(searchParams.get("teamId") || "").trim();
  const isTeamScope = scope === "team" && Boolean(teamId);
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [insights, setInsights] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [headline, setHeadline] = useState("AI Insights");
  const [subcopy, setSubcopy] = useState(
    "A focused view of the signals, risks, and next-best actions the CRM is surfacing for your current pipeline."
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadInsights() {
      try {
        setLoading(true);
        setError("");

        if (isTeamScope) {
          const response = await API.get(`/teams/dashboard?teamId=${teamId}`, {
            signal: controller.signal
          });
          const payload = response.data || {};
          const nextInsights = buildTeamInsights(payload);

          setHeadline(payload?.team?.name ? `${payload.team.name} AI Insights` : "Team AI Insights");
          setSubcopy(
            "A team-focused view of pipeline pressure, follow-up execution, and conversion signals based on current dashboard rules."
          );
          setInsights(nextInsights);
          setSnapshot([
            { label: "Pipeline Value", value: formatCurrency(payload?.kpis?.pipelineValue) },
            { label: "Active Deals", value: String(payload?.kpis?.activeDeals || 0) },
            { label: "Follow-ups Today", value: String(payload?.kpis?.followupsToday || 0) },
            { label: "Win Rate", value: `${Number(payload?.kpis?.winRate || 0)}%` }
          ]);
        } else {
          const isAdminWithoutTeamScope = roleName === "admin";
          if (isAdminWithoutTeamScope) {
            setHeadline("AI Insights");
            setSubcopy("Admin-wide AI insights are planned for a later phase. Team-level AI insights are already available from Team Dashboard.");
            setInsights([]);
            setSnapshot([]);
            setLoading(false);
            return;
          }

          const endpoint = roleName === "manager" ? "/api/manager/dashboard" : "/api/user/dashboard";
          const response = await API.get(endpoint, {
            params: { range },
            signal: controller.signal
          });
          const payload = response.data || {};
          const nextInsights = buildManagerInsights(payload, range);
          const statCards = Array.isArray(payload.statCards) ? payload.statCards : [];

          setHeadline(roleName === "manager" ? "Manager AI Insights" : "My AI Insights");
          setSubcopy(
            "A focused view of the signals, risks, and next-best actions the CRM is surfacing for your current pipeline."
          );
          setInsights(nextInsights);
          setSnapshot([
            {
              label: statCards[0]?.title || "Follow-ups & Meetings",
              value: String(
                payload?.summary?.followupsInRange + payload?.summary?.meetingsInRange ||
                statCards[0]?.value ||
                0
              )
            },
            {
              label: "Pipeline Value",
              value: formatCurrency(payload.summary?.pipelineValue)
            },
            {
              label: "Follow-ups",
              value: String((payload.followups || []).length)
            },
            {
              label: "Meetings",
              value: String((payload.meetings || []).length)
            }
          ]);
        }
      } catch (err) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setError(err.response?.data?.message || "Failed to load AI insights");
        setInsights([]);
        setSnapshot([]);
      } finally {
        setLoading(false);
      }
    }

    loadInsights();
    return () => controller.abort();
  }, [isTeamScope, range, roleName, teamId]);

  const groupedInsights = useMemo(() => {
    const high = insights.filter((item) => item.tone === "high");
    const medium = insights.filter((item) => item.tone === "medium");
    const low = insights.filter((item) => item.tone === "low");
    return { high, medium, low };
  }, [insights]);

  const actionQueue = useMemo(
    () => buildActionQueue(roleName, insights),
    [insights, roleName]
  );

  return (
    <div className="aiInsights-page">
      <section className="aiInsights-hero">
        <div className="aiInsights-heroCopy">
          <span className="aiInsights-kicker">AI Guidance Center</span>
          <h1>{headline}</h1>
          <p>{subcopy}</p>
        </div>

        <div className="aiInsights-toolbar">
          <label htmlFor="ai-insights-range">Window</label>
          <select
            id="ai-insights-range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            disabled={isTeamScope}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? (
        <div className="aiInsights-error">{error}</div>
      ) : null}

      <section className="aiInsights-snapshotGrid">
        {loading
          ? [...Array(4)].map((_, index) => (
              <div key={index} className="aiInsights-snapshotCard aiInsights-snapshotCard-loading" />
            ))
          : snapshot.map((item) => (
              <article key={item.label} className="aiInsights-snapshotCard">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
      </section>

      <section className="aiInsights-contentGrid">
        <div className="aiInsights-main">
          <div className="aiInsights-sectionHead">
            <h2>Priority Signals</h2>
            <span>{insights.length} active insight{insights.length === 1 ? "" : "s"}</span>
          </div>

          {loading ? (
            <div className="aiInsights-stateCard">Loading AI insights...</div>
          ) : insights.length === 0 ? (
            <div className="aiInsights-stateCard">No AI insights are available for this view yet.</div>
          ) : (
            <div className="aiInsights-columns">
              {[
                { key: "high", title: "High Priority", items: groupedInsights.high },
                { key: "medium", title: "Needs Attention", items: groupedInsights.medium },
                { key: "low", title: "Opportunities", items: groupedInsights.low }
              ].map((group) => (
                <section key={group.key} className="aiInsights-column">
                  <div className="aiInsights-columnHead">
                    <h3>{group.title}</h3>
                    <span>{group.items.length}</span>
                  </div>

                  <div className="aiInsights-cardStack">
                    {group.items.length === 0 ? (
                      <div className="aiInsights-emptyTone">Nothing in this bucket right now.</div>
                    ) : (
                      group.items.map((item) => (
                        <article key={item.id} className={`aiInsights-card aiInsights-card-${item.tone}`}>
                          <div className="aiInsights-cardMeta">
                            <span className={`aiInsights-pill aiInsights-pill-${item.tone}`}>
                              {toneLabel(item.tone)}
                            </span>
                            <span className="aiInsights-category">{item.category}</span>
                          </div>
                          <h4>{item.title}</h4>
                          <p>{item.message}</p>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="aiInsights-side">
          <div className="aiInsights-sectionHead">
            <h2>Recommended Moves</h2>
          </div>

          <div className="aiInsights-actions">
            {actionQueue.map((action) => (
              <article key={action.id} className="aiInsights-actionCard">
                <h3>{action.title}</h3>
                <p>{action.description}</p>
                <button type="button" onClick={() => navigate(action.path)}>
                  {action.cta}
                </button>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
