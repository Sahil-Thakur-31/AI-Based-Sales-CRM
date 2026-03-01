import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/teamSetup.css";

function getRoleName(user) {
  return user?.roleName || user?.role?.name || "";
}

export default function TeamSetup() {
  const navigate = useNavigate();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);

  const [teams, setTeams] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  const [teamName, setTeamName] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const [memberQuery, setMemberQuery] = useState("");

  useEffect(() => {
    async function loadData() {
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
    }

    loadData();
  }, []);

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

    // Lead cannot also be a member.
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

      await API.post("/teams", {
        name: teamName.trim(),
        teamLeadId: selectedLeadId,
        members: Array.from(selectedMemberIds)
      });

      setSuccess("Team created successfully");
      navigate("/team-dashboard");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Could not create team");
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
            <h2>Create Team</h2>
            <p>Choose one manager as lead and assign any non-admin users as members.</p>
          </div>
          <button className="team-setup-btn secondary" onClick={() => navigate("/team-dashboard")}>
            Go To Dashboard
          </button>
        </div>

        {teams.length > 0 ? (
          <section className="team-setup-card">
            <h3>Existing Teams</h3>
            <div className="team-setup-team-list">
              {teams.map((team) => (
                <div key={team._id} className="team-setup-team-chip">
                  <strong>{team.name || "Untitled Team"}</strong>
                  <span>{team.totalPeople || 0} members</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="team-setup-card">
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
        </section>

        {error ? <div className="team-setup-alert error">{error}</div> : null}
        {success ? <div className="team-setup-alert success">{success}</div> : null}

        <div className="team-setup-footer">
          <button className="team-setup-btn primary" onClick={submit}>
            Create Team
          </button>
        </div>
      </div>
    </div>
  );
}
