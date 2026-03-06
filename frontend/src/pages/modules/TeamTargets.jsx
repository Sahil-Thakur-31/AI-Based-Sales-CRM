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

export default function TeamTargets() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roleName = localStorage.getItem("RoleName") || "";
  const isAdmin = roleName === "Admin";
  const isManager = roleName === "Manager";
  const canAccess = isAdmin || isManager;

  const teamIdFromQuery = String(searchParams.get("teamId") || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [team, setTeam] = useState(null);
  const [periodType, setPeriodType] = useState("monthly");
  const [periodStart, setPeriodStart] = useState(firstDayOfCurrentMonthISO());
  const [teamTarget, setTeamTarget] = useState({
    revenueTarget: "",
    dealTarget: "",
    notes: ""
  });
  const [rows, setRows] = useState([]);

  const pageMode = useMemo(() => (isAdmin ? "admin-team" : "manager-member"), [isAdmin]);

  const loadContext = useCallback(async () => {
    if (!teamIdFromQuery) {
      setError("Team id is missing. Open this page from Team Dashboard.");
      setTeam(null);
      setRows([]);
      return;
    }

    const [teamsRes, targetRes] = await Promise.all([
      API.get("/teams"),
      API.get(`/teams/targets?teamId=${teamIdFromQuery}&periodType=${periodType}&periodStart=${periodStart}`)
    ]);

    const teams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
    const targetData = targetRes.data || {};
    const selectedTeam = teams.find((item) => String(item._id) === String(teamIdFromQuery)) || null;

    if (!selectedTeam) {
      setError("Team not found or not accessible");
      setTeam(null);
      setRows([]);
      return;
    }

    if (isManager && !selectedTeam?.canManage) {
      setError("Only the lead of this team can assign user targets.");
      setTeam(selectedTeam);
      setRows([]);
      return;
    }

    setTeam(selectedTeam);
    setTeamTarget({
      revenueTarget: toNumberInput(targetData?.teamTarget?.revenueTarget),
      dealTarget: toNumberInput(targetData?.teamTarget?.dealTarget),
      notes: targetData?.teamTarget?.notes || ""
    });

    const members = Array.isArray(targetData?.members) ? targetData.members : [];
    setRows(
      members.map((member) => ({
        userId: member?.user?._id || "",
        name: member?.user?.name || "Unknown",
        email: member?.user?.email || "",
        revenueTarget: toNumberInput(member?.revenueTarget),
        dealTarget: toNumberInput(member?.dealTarget),
        notes: member?.notes || ""
      }))
    );
  }, [teamIdFromQuery, periodType, periodStart, isManager]);

  useEffect(() => {
    if (!canAccess) return;

    (async () => {
      try {
        setLoading(true);
        setError("");
        await loadContext();
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || "Failed to load team targets");
      } finally {
        setLoading(false);
      }
    })();
  }, [canAccess, loadContext]);

  const updateRow = (userId, field, value) => {
    setRows((prev) =>
      prev.map((row) => (String(row.userId) === String(userId) ? { ...row, [field]: value } : row))
    );
  };

  const saveTargets = async () => {
    try {
      if (!teamIdFromQuery) {
        setError("Team id is missing");
        return;
      }

      setSaving(true);
      setError("");
      setSuccess("");

      const payload = {
        teamId: teamIdFromQuery,
        periodType,
        periodStart
      };

      if (isAdmin) {
        payload.teamTarget = {
          revenueTarget: Number(teamTarget.revenueTarget || 0),
          dealTarget: Number(teamTarget.dealTarget || 0),
          notes: String(teamTarget.notes || "").trim()
        };
      } else {
        payload.targets = rows.map((row) => ({
          userId: row.userId,
          revenueTarget: Number(row.revenueTarget || 0),
          dealTarget: Number(row.dealTarget || 0),
          notes: String(row.notes || "").trim()
        }));
      }

      await API.post("/teams/targets", payload);
      setSuccess(isAdmin ? "Team target saved successfully" : "Member targets saved successfully");
      await loadContext();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save targets");
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="team-targets-empty">
        <h3>Access Denied</h3>
        <p>Only Admin or Team Lead can access team targets.</p>
      </div>
    );
  }

  if (loading && !team && !rows.length) {
    return <div className="team-targets-loading">Loading team targets...</div>;
  }

  return (
    <div className="team-targets-page">
      <div className="team-targets-shell">
        <section className="team-targets-head">
          <div>
            <h2>{isAdmin ? "Assign Team Target" : "Assign Member Targets"}</h2>
            <p>
              Team: <strong>{team?.name || "-"}</strong>
            </p>
          </div>
          <button className="team-targets-btn secondary" onClick={() => navigate("/team-dashboard")}>
            Back To Team Dashboard
          </button>
        </section>

        <section className="team-targets-card">
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
          </div>

          {pageMode === "admin-team" ? (
            <div className="team-targets-admin-form">
              <label>
                <span>Team Revenue Target</span>
                <input
                  type="number"
                  min="0"
                  value={teamTarget.revenueTarget}
                  onChange={(e) =>
                    setTeamTarget((prev) => ({ ...prev, revenueTarget: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>Team Deal Target</span>
                <input
                  type="number"
                  min="0"
                  value={teamTarget.dealTarget}
                  onChange={(e) =>
                    setTeamTarget((prev) => ({ ...prev, dealTarget: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>Notes</span>
                <input
                  type="text"
                  value={teamTarget.notes}
                  onChange={(e) => setTeamTarget((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Notes for team target"
                />
              </label>
            </div>
          ) : (
            <>
              <div className="team-targets-team-goal">
                <strong>Team Goal (set by Admin)</strong>
                <span>Revenue: {teamTarget.revenueTarget || 0}</span>
                <span>Deals: {teamTarget.dealTarget || 0}</span>
                <span>Notes: {teamTarget.notes || "-"}</span>
              </div>

              <div className="team-targets-table-wrap">
                <table className="team-targets-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Revenue</th>
                      <th>Deals</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((row) => (
                        <tr key={row.userId}>
                          <td>
                            <div className="team-targets-user">
                              <strong>{row.name}</strong>
                              <span>{row.email}</span>
                            </div>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={row.revenueTarget}
                              onChange={(e) => updateRow(row.userId, "revenueTarget", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={row.dealTarget}
                              onChange={(e) => updateRow(row.userId, "dealTarget", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.notes}
                              onChange={(e) => updateRow(row.userId, "notes", e.target.value)}
                              placeholder="Notes"
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="team-targets-empty-row">
                          No members available in this team
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="team-targets-actions">
            <button className="team-targets-btn primary" onClick={saveTargets} disabled={saving || loading || !teamIdFromQuery}>
              {saving ? "Saving..." : "Save Targets"}
            </button>
          </div>
        </section>

        {error ? <div className="team-targets-alert error">{error}</div> : null}
        {success ? <div className="team-targets-alert success">{success}</div> : null}
      </div>
    </div>
  );
}
