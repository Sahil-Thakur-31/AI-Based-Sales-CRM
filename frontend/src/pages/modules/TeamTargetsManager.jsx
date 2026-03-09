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

function pct(value) {
  return `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

export default function TeamTargetsManager() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const teamId = String(searchParams.get("teamId") || "").trim();

  const [periodType, setPeriodType] = useState("monthly");
  const [periodStart, setPeriodStart] = useState(firstDayOfCurrentMonthISO());
  const [teamPayload, setTeamPayload] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [draftRows, setDraftRows] = useState([]);

  const loadTeamTargets = useCallback(async () => {
    if (!teamId) {
      setError("Team id is missing. Please open this page from Team Dashboard.");
      setTeamPayload(null);
      return;
    }

    const query = new URLSearchParams({
      teamId,
      periodType,
      periodStart
    });
    const res = await API.get(`/teams/targets?${query.toString()}`);
    setTeamPayload(res.data || null);
  }, [teamId, periodType, periodStart]);

  useEffect(() => {
    setIsEditing(false);
  }, [periodType, periodStart]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        setSuccess("");
        await loadTeamTargets();
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || "Failed to load team targets");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTeamTargets]);

  const memberRows = useMemo(() => {
    const members = Array.isArray(teamPayload?.members) ? teamPayload.members : [];
    return members.map((member) => ({
      userId: String(member?.user?._id || ""),
      name: member?.user?.name || "Unknown",
      email: member?.user?.email || "",
      revenueTarget: Number(member?.revenueTarget || 0),
      dealTarget: Number(member?.dealTarget || 0),
      notes: String(member?.notes || ""),
      achievedRevenue: Number(member?.achievedRevenue || 0),
      achievedDeals: Number(member?.achievedDeals || 0),
      revenueProgress: Number(member?.revenueProgress || 0),
      dealsProgress: Number(member?.dealsProgress || 0)
    }));
  }, [teamPayload]);

  const startEdit = () => {
    setDraftRows(
      memberRows.map((row) => ({
        userId: row.userId,
        revenueTarget: toNumberInput(row.revenueTarget),
        dealTarget: toNumberInput(row.dealTarget),
        notes: row.notes
      }))
    );
    setIsEditing(true);
    setError("");
    setSuccess("");
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraftRows([]);
  };

  const updateDraftRow = (userId, field, value) => {
    setDraftRows((prev) =>
      prev.map((row) =>
        String(row.userId) === String(userId)
          ? {
              ...row,
              [field]: value
            }
          : row
      )
    );
  };

  const mergedRows = useMemo(() => {
    if (!isEditing) return memberRows;

    const draftMap = new Map(draftRows.map((row) => [String(row.userId), row]));
    return memberRows.map((row) => {
      const draft = draftMap.get(String(row.userId));
      if (!draft) return row;
      return {
        ...row,
        revenueTarget: Number(draft.revenueTarget || 0),
        dealTarget: Number(draft.dealTarget || 0),
        notes: String(draft.notes || "")
      };
    });
  }, [isEditing, memberRows, draftRows]);

  const saveTargets = async () => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      await API.post("/teams/targets", {
        teamId,
        periodType,
        periodStart,
        targets: draftRows.map((row) => ({
          userId: row.userId,
          revenueTarget: Number(row.revenueTarget || 0),
          dealTarget: Number(row.dealTarget || 0),
          notes: String(row.notes || "").trim()
        }))
      });

      await loadTeamTargets();
      setIsEditing(false);
      setDraftRows([]);
      setSuccess("Member targets updated successfully.");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save member targets");
    } finally {
      setSaving(false);
    }
  };

  if (!teamId) {
    return (
      <div className="team-targets-empty">
        <h3>Team Not Selected</h3>
        <p>Please open Assign Targets from Team Dashboard.</p>
        <button className="team-targets-btn secondary" onClick={() => navigate("/team-dashboard")}>
          Back To Team Dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="team-targets-loading">Loading team targets...</div>;
  }

  const teamTarget = teamPayload?.teamTarget || {};

  return (
    <div className="team-targets-page">
      <div className="team-targets-shell">
        <section className="team-targets-head team-targets-manager-head">
          <div>
            <div className="team-targets-manager-team-row">
              <p className="team-targets-manager-team-label">Team:</p>
              <p className="team-targets-manager-team-name">{teamPayload?.team?.name || "-"}</p>
            </div>
          </div>
          <button className="team-targets-btn secondary" onClick={() => navigate("/team-dashboard")}>
            Back To Team Dashboard
          </button>
        </section>

        <section className="team-targets-card">
          <div className="team-targets-filters">
            <label>
              <span>Period Type</span>
              <select value={periodType} onChange={(e) => setPeriodType(e.target.value)} disabled={saving}>
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
                disabled={saving}
              />
            </label>
          </div>

          <div className="team-target-summary-card">
            <div className="team-target-summary-head">
              <h3>Team Target Overview</h3>
              {!isEditing ? (
                <button className="team-targets-btn primary" onClick={startEdit} disabled={!memberRows.length}>
                  Edit Member Targets
                </button>
              ) : (
                <div className="team-target-edit-actions">
                  <button className="team-targets-btn secondary" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                  <button className="team-targets-btn primary" onClick={saveTargets} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </div>

            <div className="team-target-overview">
              <div className="team-target-metric">
                <span>Team Revenue</span>
                <strong>{formatCurrency(teamTarget?.revenueTarget || 0)}</strong>
                <small>Achieved: {formatCurrency(teamTarget?.achievedRevenue || 0)}</small>
                <div className="team-target-progress-track">
                  <span style={{ width: pct(teamTarget?.revenueProgress || 0) }} />
                </div>
                <em>{pct(teamTarget?.revenueProgress || 0)} complete</em>
              </div>

              <div className="team-target-metric">
                <span>Team Deals</span>
                <strong>{Number(teamTarget?.dealTarget || 0)}</strong>
                <small>Achieved: {Number(teamTarget?.achievedDeals || 0)}</small>
                <div className="team-target-progress-track">
                  <span style={{ width: pct(teamTarget?.dealsProgress || 0) }} />
                </div>
                <em>{pct(teamTarget?.dealsProgress || 0)} complete</em>
              </div>
            </div>

            <div className="team-target-notes">
              <span>Admin Notes</span>
              <p>{teamTarget?.notes || "No notes added."}</p>
            </div>
          </div>

          <div className="team-targets-table-wrap">
            <table className="team-targets-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Assigned Revenue</th>
                  <th>Achieved Revenue</th>
                  <th>Assigned Deals</th>
                  <th>Achieved Deals</th>
                  <th>Revenue Progress</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {mergedRows.length ? (
                  mergedRows.map((row) => {
                    const isRowEditing = isEditing;
                    const draft = draftRows.find((item) => String(item.userId) === String(row.userId));
                    return (
                      <tr key={row.userId}>
                        <td>
                          <div className="team-targets-user">
                            <strong>{row.name}</strong>
                            <span>{row.email}</span>
                          </div>
                        </td>
                        <td>
                          {isRowEditing ? (
                            <input
                              type="number"
                              min="0"
                              value={draft?.revenueTarget ?? ""}
                              onChange={(e) =>
                                updateDraftRow(row.userId, "revenueTarget", e.target.value)
                              }
                            />
                          ) : (
                            <span className="team-target-cell-value">{formatCurrency(row.revenueTarget)}</span>
                          )}
                        </td>
                        <td>
                          <span className="team-target-cell-value">{formatCurrency(row.achievedRevenue)}</span>
                        </td>
                        <td>
                          {isRowEditing ? (
                            <input
                              type="number"
                              min="0"
                              value={draft?.dealTarget ?? ""}
                              onChange={(e) =>
                                updateDraftRow(row.userId, "dealTarget", e.target.value)
                              }
                            />
                          ) : (
                            <span className="team-target-cell-value">{Number(row.dealTarget || 0)}</span>
                          )}
                        </td>
                        <td>
                          <span className="team-target-cell-value">{Number(row.achievedDeals || 0)}</span>
                        </td>
                        <td>
                          <div className="team-progress-inline">
                            <div className="team-target-progress-track">
                              <span style={{ width: pct(row.revenueProgress) }} />
                            </div>
                            <small>{pct(row.revenueProgress)}</small>
                          </div>
                        </td>
                        <td>
                          {isRowEditing ? (
                            <input
                              type="text"
                              value={draft?.notes ?? ""}
                              onChange={(e) => updateDraftRow(row.userId, "notes", e.target.value)}
                              placeholder="Optional notes"
                            />
                          ) : (
                            <span className="team-target-cell-value">{row.notes || "-"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="team-targets-empty-row">
                      No team members found for this team.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {error ? <div className="team-targets-alert error">{error}</div> : null}
        {success ? <div className="team-targets-alert success">{success}</div> : null}
      </div>
    </div>
  );
}
