import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../../api";
import "./styles/teamTargets.css";

function firstDayOfCurrentMonthISO() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const yyyy = firstDay.getFullYear();
  const mm = String(firstDay.getMonth() + 1).padStart(2, "0");
  const dd = String(firstDay.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toNumberInput(value) {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatPercent(value) {
  return `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

function buildTargetQuery(teamId, periodType, periodStart) {
  const query = new URLSearchParams({
    teamId: String(teamId || ""),
    periodType: String(periodType || "monthly"),
    periodStart: String(periodStart || firstDayOfCurrentMonthISO())
  });
  return `/teams/targets?${query.toString()}`;
}

export default function TeamTargetsAdmin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightTeamId = String(searchParams.get("teamId") || "").trim();

  const [periodType, setPeriodType] = useState("monthly");
  const [periodStart, setPeriodStart] = useState(firstDayOfCurrentMonthISO());

  const [teams, setTeams] = useState([]);
  const [targetsByTeam, setTargetsByTeam] = useState({});
  const [editingTeamId, setEditingTeamId] = useState("");
  const [draftTarget, setDraftTarget] = useState({
    revenueTarget: "",
    dealTarget: "",
    notes: ""
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingTeamId, setSavingTeamId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadTeamsAndTargets = useCallback(async () => {
    setError("");
    setSuccess("");

    const teamsRes = await API.get("/teams");
    const teamRows = Array.isArray(teamsRes.data) ? teamsRes.data : [];

    setTeams(teamRows);

    if (!teamRows.length) {
      setTargetsByTeam({});
      return;
    }

    const targetRequests = teamRows.map((team) =>
      API.get(buildTargetQuery(team._id, periodType, periodStart))
    );
    const targetResults = await Promise.allSettled(targetRequests);

    const mappedTargets = {};
    targetResults.forEach((result, index) => {
      const team = teamRows[index];
      if (!team?._id) return;

      if (result.status === "fulfilled") {
        mappedTargets[String(team._id)] = result.value?.data || null;
      } else {
        mappedTargets[String(team._id)] = {
          __error: result.reason?.response?.data?.message || "Failed to load team target"
        };
      }
    });

    setTargetsByTeam(mappedTargets);
  }, [periodType, periodStart]);

  useEffect(() => {
    setEditingTeamId("");
    setDraftTarget({ revenueTarget: "", dealTarget: "", notes: "" });
  }, [periodType, periodStart]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadTeamsAndTargets();
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || "Failed to load team targets");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTeamsAndTargets]);

  const refreshAll = async () => {
    try {
      setRefreshing(true);
      await loadTeamsAndTargets();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to refresh targets");
    } finally {
      setRefreshing(false);
    }
  };

  const openEdit = (teamId) => {
    const targetData = targetsByTeam[String(teamId)] || {};
    const teamTarget = targetData?.teamTarget || {};

    setDraftTarget({
      revenueTarget: toNumberInput(teamTarget?.revenueTarget),
      dealTarget: toNumberInput(teamTarget?.dealTarget),
      notes: String(teamTarget?.notes || "")
    });
    setEditingTeamId(String(teamId));
    setError("");
    setSuccess("");
  };

  const cancelEdit = () => {
    setEditingTeamId("");
    setDraftTarget({ revenueTarget: "", dealTarget: "", notes: "" });
  };

  const saveTeamTarget = async (teamId) => {
    try {
      setSavingTeamId(String(teamId));
      setError("");
      setSuccess("");

      await API.post("/teams/targets", {
        teamId,
        periodType,
        periodStart,
        teamTarget: {
          revenueTarget: Number(draftTarget.revenueTarget || 0),
          dealTarget: Number(draftTarget.dealTarget || 0),
          notes: String(draftTarget.notes || "").trim()
        }
      });

      const res = await API.get(buildTargetQuery(teamId, periodType, periodStart));
      setTargetsByTeam((prev) => ({
        ...prev,
        [String(teamId)]: res.data || null
      }));

      setEditingTeamId("");
      setSuccess("Team target updated successfully.");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save team target");
    } finally {
      setSavingTeamId("");
    }
  };

  const teamCards = useMemo(() => {
    return teams.map((team) => {
      const teamId = String(team._id || "");
      const payload = targetsByTeam[teamId] || {};
      const teamTarget = payload?.teamTarget || {};
      const teamInfo = payload?.team || {};
      const leadName =
        teamInfo?.lead?.name || team?.teamLeads?.[0]?.userId?.name || "Not Assigned";

      return {
        team,
        teamId,
        hasError: Boolean(payload?.__error),
        errorMessage: payload?.__error || "",
        assignedRevenue: Number(teamTarget?.revenueTarget || 0),
        achievedRevenue: Number(teamTarget?.achievedRevenue || 0),
        revenueProgress: Number(teamTarget?.revenueProgress || 0),
        assignedDeals: Number(teamTarget?.dealTarget || 0),
        achievedDeals: Number(teamTarget?.achievedDeals || 0),
        dealsProgress: Number(teamTarget?.dealsProgress || 0),
        notes: String(teamTarget?.notes || ""),
        leadName,
        memberCount: Number(teamInfo?.memberCount || team?.memberCount || 0),
        updatedAt: teamTarget?.updatedAt || null
      };
    });
  }, [teams, targetsByTeam]);

  if (loading) {
    return <div className="team-targets-loading">Loading team targets...</div>;
  }

  if (!teams.length) {
    return (
      <div className="team-targets-empty">
        <h3>No Teams Available</h3>
        <p>Create teams first to assign targets.</p>
        <button className="team-targets-btn secondary" onClick={() => navigate("/team-setup")}>Create Team</button>
      </div>
    );
  }

  return (
    <div className="team-targets-page team-targets-admin-page">
      <div className="team-targets-shell team-targets-shell-wide team-targets-admin-shell">
        <section className="team-targets-head team-targets-admin-head">
          <div>
            <h2>Team Targets - Admin</h2>
            <p>View and manage targets for all teams in one place.</p>
          </div>
          <button className="team-targets-btn secondary" onClick={() => navigate("/team-dashboard")}>
            Back To Team Dashboard
          </button>
        </section>

        <section className="team-targets-card team-targets-admin-filters-card">
          <div className="team-targets-filters">
            <label>
              <span>Period Type</span>
              <select value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </label>
            <label>
              <span>Period Start</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </label>
            <div className="team-targets-filter-action">
              <button className="team-targets-btn secondary" onClick={refreshAll} disabled={refreshing || loading}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        <section className="team-targets-grid team-targets-admin-grid">
          {teamCards.map((card) => {
            const isEditing = editingTeamId === card.teamId;
            const isHighlighted = highlightTeamId && highlightTeamId === card.teamId;
            return (
              <article
                key={card.teamId}
                className={`team-target-card team-targets-admin-card ${isHighlighted ? "highlight" : ""}`.trim()}
              >
                <header className="team-target-card-head">
                  <div>
                    <h3>{card.team.name || "Untitled Team"}</h3>
                    <p>
                      Lead: <strong>{card.leadName}</strong> | Members: <strong>{card.memberCount}</strong>
                    </p>
                  </div>
                  {!isEditing ? (
                    <button
                      className="team-targets-btn primary"
                      onClick={() => openEdit(card.teamId)}
                      disabled={card.hasError}
                    >
                      Edit Target
                    </button>
                  ) : null}
                </header>

                {card.hasError ? (
                  <div className="team-targets-alert error">{card.errorMessage}</div>
                ) : (
                  <>
                    <div className="team-target-overview">
                      <div className="team-target-metric">
                        <span>Revenue</span>
                        <strong>{formatCurrency(card.assignedRevenue)}</strong>
                        <small>Achieved: {formatCurrency(card.achievedRevenue)}</small>
                        <div className="team-target-progress-track">
                          <span style={{ width: formatPercent(card.revenueProgress) }} />
                        </div>
                        <em>{formatPercent(card.revenueProgress)} complete</em>
                      </div>

                      <div className="team-target-metric">
                        <span>Deals</span>
                        <strong>{card.assignedDeals}</strong>
                        <small>Achieved: {card.achievedDeals}</small>
                        <div className="team-target-progress-track">
                          <span style={{ width: formatPercent(card.dealsProgress) }} />
                        </div>
                        <em>{formatPercent(card.dealsProgress)} complete</em>
                      </div>
                    </div>

                    <div className="team-target-notes">
                      <span>Notes</span>
                      <p>{card.notes || "No notes added."}</p>
                    </div>

                    {card.updatedAt ? (
                      <div className="team-target-updated">
                        Last updated: {new Date(card.updatedAt).toLocaleString("en-GB")}
                      </div>
                    ) : null}

                    {isEditing ? (
                      <div className="team-target-edit-panel">
                        <label>
                          <span>Team Revenue Target</span>
                          <input
                            type="number"
                            min="0"
                            value={draftTarget.revenueTarget}
                            onChange={(e) =>
                              setDraftTarget((prev) => ({ ...prev, revenueTarget: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          <span>Team Deal Target</span>
                          <input
                            type="number"
                            min="0"
                            value={draftTarget.dealTarget}
                            onChange={(e) =>
                              setDraftTarget((prev) => ({ ...prev, dealTarget: e.target.value }))
                            }
                          />
                        </label>
                        <label className="full">
                          <span>Notes</span>
                          <textarea
                            value={draftTarget.notes}
                            onChange={(e) =>
                              setDraftTarget((prev) => ({ ...prev, notes: e.target.value }))
                            }
                            placeholder="Optional note for this team target"
                            rows={3}
                          />
                        </label>

                        <div className="team-target-edit-actions">
                          <button
                            className="team-targets-btn secondary"
                            onClick={cancelEdit}
                            disabled={savingTeamId === card.teamId}
                          >
                            Cancel
                          </button>
                          <button
                            className="team-targets-btn primary"
                            onClick={() => saveTeamTarget(card.teamId)}
                            disabled={savingTeamId === card.teamId}
                          >
                            {savingTeamId === card.teamId ? "Saving..." : "Save Team Target"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            );
          })}
        </section>

        {error ? <div className="team-targets-alert error">{error}</div> : null}
        {success ? <div className="team-targets-alert success">{success}</div> : null}
      </div>
    </div>
  );
}
