import { useEffect, useState } from "react";
import API from "../api";
import MeetingsEventsPanel from "../components/MeetingsEventsPanel";
import StatCard from "../components/StatCard";
import "../styles/managerDashboard.css";

function Dashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState("month");

  function formatCurrency(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    });
  }

  function formatTime(value) {
    if (!value) return "--";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";

    return date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getFollowupColor(priority = "") {
    const normalized = String(priority).toLowerCase();
    if (normalized === "high") return "red";
    if (normalized === "medium") return "orange";
    return "blue";
  }

  function getRangeLabel(value) {
    if (value === "week") {
      return {
        followups: "This Week's Follow-ups & Meetings",
        target: "Current Target"
      };
    }

    if (value === "quarter") {
      return {
        followups: "This Quarter's Follow-ups & Meetings",
        target: "Quarterly Target"
      };
    }

    return {
      followups: "This Month's Follow-ups & Meetings",
      target: "Monthly Target"
    };
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        setError("");
        const response = await API.get("/api/manager/dashboard", {
          params: { range },
          signal: controller.signal
        });
        setDashboardData(response.data);
      } catch (err) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setError(err.response?.data?.message || "Failed to load dashboard");
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [range]);

  if (!dashboardData) {
    return <p>{error || "Loading..."}</p>;
  }

  const labels = getRangeLabel(range);
  const timelineItems = [
    ...(dashboardData.followups || []),
    ...(dashboardData.meetings || [])
  ].sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
  const stats = [
    {
      title: labels.followups,
      value: (dashboardData.summary.followupsToday || 0) + (dashboardData.summary.meetingsToday || 0),
      sub: `${dashboardData.summary.highPriorityFollowups} high priority follow-ups, ${dashboardData.summary.meetingsToday || 0} meetings`,
      icon: "📞",
      color: "blue"
    },
    {
      title: "Active Deals",
      value: dashboardData.summary.activeDeals,
      sub: `+${dashboardData.summary.dealsAddedThisWeek} this week`,
      icon: "💼",
      color: "green"
    },
    {
      title: labels.target,
      value: formatCurrency(dashboardData.summary.monthlyTarget),
      sub: `${dashboardData.summary.monthlyAchievedPct}% achieved (${formatCurrency(dashboardData.summary.monthlyAchieved)})`,
      icon: "🎯",
      color: "orange"
    },
    {
      title: "Win Rate",
      value: `${dashboardData.summary.winRate}%`,
      sub: `${dashboardData.summary.wonDeals} won of ${dashboardData.summary.closedDeals} closed deals`,
      icon: "⭐",
      color: "purple"
    }
  ];

  return (
    <div className="ManagerDashboard">
      <div className="dashboard container-fluid">
        {error ? <p>{error}</p> : null}

        <div className="row g-4 mt-2">
          {stats.map((stat, index) => (
            <div key={index} className="col-12 col-sm-6 col-lg-3">
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        <div className="row mt-4">
          <div className="col-12">
            <div className="panel">
              <MeetingsEventsPanel
                activityData={dashboardData.activity}
                range={range}
                onRangeChange={setRange}
              />
            </div>
          </div>
        </div>

        <div className="row mt-4">
          <div className="col-12 col-lg-8">
            <div className="panel">
              <h3>{labels.followups}</h3>

              {timelineItems.length ? (
                timelineItems.map((item) => (
                  <div key={item.id} className={`follow-item ${getFollowupColor(item.priority)}`}>
                    <div>
                      <strong>{item.company}</strong>
                      <div className="follow-item-meta">
                        <span className={`follow-kind follow-kind--${item.kind || "followup"}`}>
                          {item.kind === "meeting" ? "Meeting" : "Follow-up"}
                        </span>
                      </div>
                      <p>{item.message}</p>
                    </div>
                    <div className="text-end">
                      <small>{formatTime(item.dueAt)}</small>
                      <div>{item.priority}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p>No follow-ups or meetings found for this range.</p>
              )}
            </div>
          </div>

          <div className="col-12 col-lg-4">
            <div className="panel mb-4">
              <h3>Pipeline Value</h3>
              <div className="pipeline-value">{formatCurrency(dashboardData.summary.pipelineValue)}</div>
            </div>

            <div className="panel">
              <h3>AI Insights</h3>

              {dashboardData.insights.map((insight) => (
                <div key={insight.id} className={`insight ${insight.severity || "purple"}`}>
                  <strong>{insight.type}</strong>
                  <p>{insight.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
