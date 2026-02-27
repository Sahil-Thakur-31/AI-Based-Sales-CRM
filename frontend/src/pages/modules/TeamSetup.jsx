import { useEffect, useState } from 'react';
import API from '../../api';
import { useNavigate } from 'react-router-dom';

function TeamSetup() {
  const [error, setError] = useState(null);
  const [teams, setTeams] = useState([]);
  const [currentTeam, setCurrentTeam] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [managers, setManagers] = useState([]);
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [managerQuery, setManagerQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    API.get('/teams')
      .then(res => {
        setTeams(res.data || []);
        // do not auto-select a team so creation inputs show
      })
      .catch(_ => {});

    // load managers and regular users
    API.get('/users')
      .then(res => {
        // API returns {roleName} field
        console.log('users loaded', res.data);
        setManagers(res.data.filter(u => u.roleName === 'Manager'));
        setUsers(res.data.filter(u => u.roleName === 'User'));
      })
      .catch(_ => {});
  }, []);


  const submit = () => {
    if (currentTeam) {
      // existing team management is handled elsewhere
      navigate('/team-dashboard');
    } else {
      if (!teamName.trim()) {
        setError('Team name is required');
        return;
      }
      if (selectedLeads.size === 0) {
        setError('Please select at least one manager as team lead');
        return;
      }
      // send arrays
      API.post('/teams', {
        name: teamName,
        teamLeadIds: Array.from(selectedLeads),
        members: Array.from(selectedUsers)
      })
        .then(() => {
          navigate('/team-dashboard');
        })
        .catch(err => setError(err.response?.data?.message || 'Could not create team'));
    }
  };

  return (
    <div className="container mt-4">
      <h2>{currentTeam ? 'Manage Team' : 'Setup Your Team'}</h2>
      {error && <p className="text-danger">{error}</p>}

      {/* existing teams selector */}
      {teams.length > 0 && (
        <div className="mb-3">
          <label className="form-label">Choose team to manage or create new:</label>
          <select
            className="form-select"
            value={currentTeam?._id || ''}
            onChange={e => {
              const t = teams.find(x => x._id === e.target.value);
              setCurrentTeam(t || null);
              if (t) setTeamName(t.name || '');
              else setTeamName('');
            }}
          >
            <option value="">-- new team --</option>
            {teams.map((t, i) => (
              <option key={t._id} value={t._id}>
                {t.name || `Team ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {currentTeam && currentTeam.teamLeads && currentTeam.teamLeads.length > 0 && (
        <div className="mb-3">
          <h4>Team Lead(s)</h4>
          <ul>
            {currentTeam.teamLeads.map((m, idx) => (
              <li key={idx}>{m.userId?.name || m.userId?.email}</li>
            ))}
          </ul>
        </div>
      )}

      {currentTeam && currentTeam.members && currentTeam.members.length > 0 && (
        <div className="mb-3">
          <h4>Current members</h4>
          <ul>
            {currentTeam.members.map((m, idx) => (
              <li key={idx} className="d-flex justify-content-between align-items-center">
                <span>{m.userId?.name || m.userId?.email}</span>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    API.post('/teams/remove-member', { userId: m.userId?._id, teamId: currentTeam._id })
                      .then(() => {
                        API.get('/teams').then(res => {
                          setTeams(res.data || []);
                          const updated = res.data.find(x => x._id === currentTeam._id);
                          setCurrentTeam(updated || null);
                        });
                      })
                      .catch(err => setError(err.response?.data?.message || 'Failed to remove'));
                  }}
                >Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* show creation area when no team selected */}
      {!currentTeam && (
        <>
          <div className="mb-3">
            <label className="form-label">Team Name</label>
            <input
              type="text"
              className="form-control"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Managers</label>
            <input
              type="text"
              className="form-control"
              placeholder="Search managers..."
              value={managerQuery}
              onChange={e => setManagerQuery(e.target.value)}
            />
            <div className="tag-container mt-1">
              {[...selectedLeads].map(id => {
                const u = managers.find(m => m._id === id);
                return u ? (
                  <span key={id} className="badge bg-primary me-1">
                    {u.name || u.email}
                    <button type="button" className="btn-close btn-close-white btn-sm ms-1" aria-label="Remove" onClick={() => {
                      const copy = new Set(selectedLeads);
                      copy.delete(id);
                      setSelectedLeads(copy);
                    }}></button>
                  </span>
                ) : null;
              })}
            </div>
            {managerQuery && (
              <div className="list-group mt-1" style={{maxHeight: '150px', overflowY:'auto'}}>
                {managers.filter(m => (m.name||m.email).toLowerCase().includes(managerQuery.toLowerCase()) && !selectedLeads.has(m._id)).map(m => (
                  <div key={m._id} className="list-group-item list-group-item-action" onClick={() => {
                    const copy = new Set(selectedLeads);
                    copy.add(m._id);
                    setSelectedLeads(copy);
                    setManagerQuery('');
                  }}>
                    {m.name || m.email}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mb-3">
            <label className="form-label">Users</label>
            <input
              type="text"
              className="form-control"
              placeholder="Search users..."
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
            />
            <div className="tag-container mt-1">
              {[...selectedUsers].map(id => {
                const u = users.find(u2 => u2._id === id);
                return u ? (
                  <span key={id} className="badge bg-secondary me-1">
                    {u.name || u.email}
                    <button type="button" className="btn-close btn-close-white btn-sm ms-1" aria-label="Remove" onClick={() => {
                      const copy = new Set(selectedUsers);
                      copy.delete(id);
                      setSelectedUsers(copy);
                    }}></button>
                  </span>
                ) : null;
              })}
            </div>
            {userQuery && (
              <div className="list-group mt-1" style={{maxHeight: '150px', overflowY:'auto'}}>
                {users.filter(u => (u.name||u.email).toLowerCase().includes(userQuery.toLowerCase()) && !selectedUsers.has(u._id)).map(u => (
                  <div key={u._id} className="list-group-item list-group-item-action" onClick={() => {
                    const copy = new Set(selectedUsers);
                    copy.add(u._id);
                    setSelectedUsers(copy);
                    setUserQuery('');
                  }}>
                    {u.name || u.email}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <button className="btn btn-primary mt-3" onClick={submit}>
        {currentTeam ? 'View Dashboard' : 'Create Team'}
      </button>
    </div>
  );
}

export default TeamSetup;