import React from 'react';
import './FollowupHistoryTimeline.css';

const FollowupHistoryTimeline = ({ followups = [] }) => {
  if (!followups || followups.length === 0) {
    return <div className="no-history">No follow-up history available.</div>;
  }

  const getStatusClass = (status, isCompleted) => {
    const s = String(status || (isCompleted ? 'completed' : 'pending')).toLowerCase();
    if (s === 'completed') return 'status-completed';
    if (s === 'cancelled' || s === 'canceled') return 'status-cancelled';
    if (s === 'overdue') return 'status-overdue';
    return 'status-pending';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? dateString : date.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  };

  return (
    <div className="followup-timeline-wrapper">
      <h3 className="timeline-header">Follow-up History ({followups.length})</h3>
      <div className="timeline-container">
        <div className="timeline-line"></div>
        {followups.map((item, index) => {
          const statusClass = getStatusClass(item.status, item.is_completed);
          const displayStatus = item.status || (item.is_completed ? 'Completed' : 'Pending');
          
          return (
            <div key={item.followup_id || index} className="timeline-item">
              <div className={`timeline-dot ${statusClass}`}></div>
              <div className="timeline-content">
                <div className="timeline-content-header">
                  <span className="timeline-date">{formatDate(item.contacted_at || item.dueDateTime || item.next_action_date)}</span>
                  <span className={`timeline-badge ${statusClass}`}>{displayStatus}</span>
                </div>
                <div className="timeline-body">
                  <div className="timeline-field">
                    <span className="field-label">Reply / Outcome</span>
                    <span className="field-value">{item.reply || item.title || '-'}</span>
                  </div>
                  <div className="timeline-field">
                    <span className="field-label">Notes</span>
                    <span className="field-value">{item.notes || '-'}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FollowupHistoryTimeline;