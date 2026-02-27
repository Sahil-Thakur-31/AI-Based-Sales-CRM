import { useEffect, useState } from "react";
import { useNavigate } from 'react-router-dom';
import StatCard from '../../components/StatCard';
import './styles/teamDashboard.css';
import API from '../../api';

function TeamDashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const navigate = useNavigate();
  const roleName = localStorage.getItem('RoleName');

  useEffect(() => {
    // load teams list first
    API.get('/teams')
      .then(res => {
        setTeams(res.data || []);
        if (res.data && res.data.length > 0) {
          setSelectedTeamId(res.data[0]._id);
        }
      })
      .catch(err => {
        console.error(err);
        setError('Unable to load teams');
      });
  }, []);

  // whenever selectedTeamId changes fetch stats
  useEffect(() => {
    if (!selectedTeamId) return;
    API.get(`/teams/dashboard?teamId=${selectedTeamId}`)
      .then(res => {
        setDashboardData(res.data);
        setError(null);
      })
      .catch(err => {
        console.error(err);
        setError(err.response?.data?.message || 'Failed to load');
        setDashboardData(null);
      });
  }, [selectedTeamId]);

  // no teams at all
  if (!error && teams && teams.length === 0) {
    return (
      <div className="container mt-4">
        <h3>You don't have a team yet.</h3>
        <p>Click the button below to create one and add members.</p>
        {roleName === 'Admin' && (
          <button className="btn btn-primary" onClick={() => { navigate('/team-setup'); }}>
            Create New Team
          </button>
        )}
        {roleName !== 'Admin' && (
          <p className="text-muted">Please contact an administrator to create a team for you.</p>
        )}
      </div>
    );
  }

  if (error) {
    if (error === 'Team not found' || error === 'Unable to load teams') {
      return (
        <div className="container mt-4">
          <h3>You don't have a team yet.</h3>
          <p>Click the button below to create one and add members.</p>
          <button className="btn btn-primary" onClick={() => { navigate('/team-setup'); }}>
            Create My Team
          </button>
        </div>
      );
    }
    return <p className="text-danger">{error}</p>;
  }
  if (!dashboardData) return <p>Loading...</p>;

  const { members, teamLeads } = dashboardData;

  return (
    <div className="TeamDashboard">
      <div className="dashboard container-fluid">
        {/* BUTTON & DROPDOWN ON SAME ROW */}
        <div className="team-selector-wrapper">
          {/* ADMIN CREATE BUTTON - LEFT */}
          {roleName === 'Admin' && (
            <button className="btn btn-primary" onClick={() => { navigate('/team-setup'); }}>
              ➕ Create New Team
            </button>
          )}

          {/* DROPDOWN - RIGHT */}
          {teams && teams.length > 0 && (
            <div className="team-dropdown-container">
              <label className="form-label">
                <strong>Select Team:</strong>
              </label>
              <select
                className="form-select"
                value={selectedTeamId || ''}
                onChange={e => setSelectedTeamId(e.target.value)}
              >
                {teams.map((t, idx) => (
                  <option key={t._id} value={t._id}>
                    {t.name || `Team ${idx + 1}`}{t.teamLeads && t.teamLeads.length > 0 ? ` (${t.teamLeads.map(l=>l.userId?.name||l.userId?.email).join(', ')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* TEAM LEADS & MEMBERS ON SAME ROW */}
        <div className="team-info-row mt-4">
          {/* TEAM LEADS */}
          {teamLeads && teamLeads.length > 0 && (
            <div className="team-card">
              <h3>👑 Team Leads</h3>
              <ul>
                {teamLeads.map((l, idx) => (
                  <li key={idx}>
                    <div className="member-name">{l.userId?.name || 'Unknown'}</div>
                    <div className="member-email">{l.userId?.email}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* TEAM MEMBERS */}
          {members && members.length > 0 && (
            <div className="team-card">
              <h3>👥 Team Members</h3>
              <ul>
                {members.map((m, idx) => (
                  <li key={idx}>
                    <div className="member-name">{m.userId?.name || 'Unknown'}</div>
                    <div className="member-email">{m.userId?.email}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* STATS ROW */}
        <div className="row g-4 mt-2">
          {dashboardData.stats.map((stat, i) => (
            <div key={i} className="col-12 col-sm-6 col-lg-3">
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        {/* BOTTOM SECTION */}
        <div className="row mt-4">

          {/* LEFT */}
          <div className="col-12 col-lg-8">
            <div className="panel panel-followups">
              <h3>🔥 Priority Follow-ups Today</h3>
              <div className="panel-scroll">
                  {dashboardData.followups.map((item, idx) => (
                    <div key={idx} className="follow-item">
                      <div>
                        <strong>{item.company_name || item.company}</strong>
                        <p>{item.message}</p>
                      </div>
                      <div className="text-end">
                        <small>{item.last_contact_date ? new Date(item.last_contact_date).toLocaleTimeString() : item.time}</small>
                        <div>{item.priority || ''}</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="col-12 col-lg-4">
            <div className="panel panel-insights">
              <h3>📈 AI Insights</h3>
              <div className="panel-scroll">
                {dashboardData.insights.map((insight, idx) => (
                  <div key={idx} className="insight">
                    <strong>{insight.type}</strong>
                    <p>{insight.message}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}

export default TeamDashboard;