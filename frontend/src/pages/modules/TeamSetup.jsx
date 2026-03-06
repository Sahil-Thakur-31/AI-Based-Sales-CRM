import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/teamSetup.css";

function getRoleName(user) {
  return user?.roleName || user?.role?.name || "";
}

export default function TeamSetup() {
  const navigate = useNavigate();
  const roleName = localStorage.getItem("RoleName") || "";
  const canCreateTeam = roleName === "Admin";
  const formRef = useRef(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [teams, setTeams] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  const [editTeamId, setEditTeamId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const [memberQuery, setMemberQuery] = useState("");
  const [teamSearch, setTeamSearch] = useState("");

  const isEditMode = Boolean(editTeamId);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [teamsRes, usersRes] = await Promise.all([API.get("/teams"), API.get("/users")]);
      setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
      setAllUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to load team setup data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const managers = useMemo(
    () =>
      allUsers.filter(
        (user) => String(getRoleName(user)).toLowerCase() === "manager" && user?.is_active !== false
      ),
    [allUsers]
  );

  const memberPool = useMemo(
    () =>
      allUsers.filter((user) => {
        const role = String(getRoleName(user)).toLowerCase();
        const isActive = user?.is_active !== false;
        return role !== "admin" && isActive;
      }),
    [allUsers]
  );

  const selectedMembers = useMemo(
    () => memberPool.filter((user) => selectedMemberIds.has(String(user._id))),
    [memberPool, selectedMemberIds]
  );

  const filteredMemberOptions = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return [];

    return memberPool
      .filter((user) => {
        const id = String(user._id);
        const searchText = `${user.name || ""} ${user.email || ""} ${getRoleName(user)}`.toLowerCase();
        return !selectedMemberIds.has(id) && id !== selectedLeadId && searchText.includes(query);
      })
      .slice(0, 12);
  }, [memberPool, memberQuery, selectedMemberIds, selectedLeadId]);

  const filteredTeams = useMemo(() => {
    const query = teamSearch.trim().toLowerCase();
    if (!query) return teams;

    return teams.filter((team) => {
      const leadName = team?.teamLeads?.[0]?.userId?.name || "";
      const text = `${team?.name || ""} ${leadName}`.toLowerCase();
      return text.includes(query);
    });
  }, [teams, teamSearch]);

  const resetFormToCreate = () => {
    setEditTeamId("");
    setTeamName("");
    setSelectedLeadId("");
    setSelectedMemberIds(new Set());
    setMemberQuery("");
    setError("");
    setSuccess("");
  };

  const loadTeamIntoForm = (team) => {
    if (!team?._id) return;
    if (!team?.canManage) {
      setError("You are not allowed to edit this team");
      return;
    }

    const leadId = String(team.teamLeads?.[0]?.userId?._id || "");
    const memberIds = new Set(
      (team.members || [])
        .map((member) => String(member?.userId?._id || ""))
        .filter(Boolean)
    );

    setEditTeamId(String(team._id));
    setTeamName(team.name || "");
    setSelectedLeadId(leadId);
    setSelectedMemberIds(memberIds);
    setMemberQuery("");
    setError("");
    setSuccess("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function addMember(userId) {
    const id = String(userId);
    if (!id || id === selectedLeadId) return;
    setSelectedMemberIds((prev) => new Set([...prev, id]));
    setMemberQuery("");
  }

  function removeMember(userId) {
    const id = String(userId);
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function onLeadChange(newLeadId) {
    const id = String(newLeadId || "");
    setSelectedLeadId(id);
    if (!id) return;

    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function submit() {
    try {
      setError("");
      setSuccess("");

      if (!teamName.trim()) {
        setError("Team name is required");
        return;
      }

      if (!selectedLeadId) {
        setError("Please select one team lead");
        return;
      }

      setSaving(true);

      const payload = {
        name: teamName.trim(),
        teamLeadId: selectedLeadId,
        members: Array.from(selectedMemberIds)
      };

      if (isEditMode) {
        await API.put(`/teams/${editTeamId}`, payload);
        setSuccess("Team updated successfully");
      } else {
        if (!canCreateTeam) {
          setError("Only admin can create a new team");
          return;
        }
        await API.post("/teams", payload);
        setSuccess("Team created successfully");
        resetFormToCreate();
      }

      await loadData();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || `Could not ${isEditMode ? "update" : "create"} team`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(team) {
    const teamId = String(team?._id || "");
    if (!teamId) return;
    if (!team?.canManage) {
      setError("You are not allowed to delete this team");
      return;
    }

    const yes = window.confirm(
      `Delete team "${team?.name || "Untitled Team"}"? This action cannot be undone.`
    );
    if (!yes) return;

    try {
      setError("");
      setSuccess("");
      await API.delete(`/teams/${teamId}`);
      setSuccess("Team deleted successfully");

      if (editTeamId === teamId) {
        resetFormToCreate();
      }

      await loadData();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Could not delete team");
    }
  }

  if (loading) {
    return <div className="team-setup-loading">Loading team setup...</div>;
  }

  return (
    <div className="team-setup-page">
      <div className="team-setup-shell">
        <div className="team-setup-header">
          <div>
            <h2>Team Setup</h2>
            <p>Choose one manager as lead and assign any non-admin users as members.</p>
            <p className="team-setup-mode-note">
              Mode: {isEditMode ? "Editing Existing Team" : "Creating New Team"}
            </p>
          </div>
          <button className="team-setup-btn secondary" onClick={() => navigate("/team-dashboard")}>
            Back To Team Dashboard
          </button>
        </div>

        {teams.length > 0 ? (
          <section className="team-setup-card">
            <div className="team-setup-existing-head">
              <h3>Existing Teams</h3>
              <input
                className="team-setup-team-search"
                type="text"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search teams by name or lead"
              />
            </div>
            <div className="team-setup-team-list">
              {filteredTeams.length ? (
                filteredTeams.map((team) => (
                  <div key={team._id} className="team-setup-team-chip">
                    <div className="team-setup-team-chip-head">
                      <div className="team-setup-team-chip-title">
                        <strong>{team.name || "Untitled Team"}</strong>
                        <small>Lead: {team?.teamLeads?.[0]?.userId?.name || "-"}</small>
                      </div>
                      <div className="team-setup-team-chip-actions">
                        <button
                          className="team-setup-icon-btn edit"
                          title="Edit team"
                          disabled={!team?.canManage}
                          onClick={() => loadTeamIntoForm(team)}
                        >
                          {"\u270E"}
                        </button>
                        <button
                          className="team-setup-icon-btn delete"
                          title="Delete team"
                          disabled={!team?.canManage}
                          onClick={() => deleteTeam(team)}
                        >
                          {"\uD83D\uDDD1"}
                        </button>
                      </div>
                    </div>
                    <span>{team.totalPeople || 0} members</span>
                  </div>
                ))
              ) : (
                <div className="team-setup-empty">No team matches your search</div>
              )}
            </div>
          </section>
        ) : null}

        <section className="team-setup-card" ref={formRef}>
          <h3>{isEditMode ? "Edit Team" : "Create Team"}</h3>

          <div className="team-setup-field-grid">
            <label className="team-setup-field">
              <span>Team Name</span>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. North Zone Pipeline Team"
              />
            </label>

            <label className="team-setup-field">
              <span>Team Lead (Manager only)</span>
              <select value={selectedLeadId} onChange={(e) => onLeadChange(e.target.value)}>
                <option value="">Select Manager</option>
                {managers.map((manager) => (
                  <option key={manager._id} value={manager._id}>
                    {manager.name || manager.email} ({manager.email})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="team-setup-members">
            <label className="team-setup-field">
              <span>Team Members (Any role except Admin)</span>
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Search by name, email, or role"
              />
            </label>

            {filteredMemberOptions.length > 0 ? (
              <div className="team-setup-suggest">
                {filteredMemberOptions.map((user) => (
                  <button
                    key={user._id}
                    className="team-setup-suggest-item"
                    onClick={() => addMember(user._id)}
                  >
                    <strong>{user.name || "Unnamed User"}</strong>
                    <span>
                      {user.email} | {getRoleName(user)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="team-setup-selected-list">
              {selectedMembers.length ? (
                selectedMembers.map((user) => (
                  <div key={user._id} className="team-setup-selected-chip">
                    <div>
                      <strong>{user.name || "Unnamed User"}</strong>
                      <span>
                        {user.email} | {getRoleName(user)}
                      </span>
                    </div>
                    <button onClick={() => removeMember(user._id)}>Remove</button>
                  </div>
                ))
              ) : (
                <div className="team-setup-empty">No members selected</div>
              )}
            </div>
          </div>

          <div className="team-setup-footer">
            {isEditMode ? (
              <button className="team-setup-btn secondary" onClick={resetFormToCreate} disabled={saving}>
                Cancel Edit
              </button>
            ) : null}
            <button
              className="team-setup-btn primary"
              onClick={submit}
              disabled={saving || (!isEditMode && !canCreateTeam)}
              title={!isEditMode && !canCreateTeam ? "Only admin can create new teams" : ""}
            >
              {saving ? "Saving..." : isEditMode ? "Update Team" : "Create Team"}
            </button>
          </div>
        </section>

        {error ? <div className="team-setup-alert error">{error}</div> : null}
        {success ? <div className="team-setup-alert success">{success}</div> : null}
      </div>
    </div>
  );
}
