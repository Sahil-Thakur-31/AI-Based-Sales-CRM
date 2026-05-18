import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import "../styles/meetingsPanel.css";

const COLORS1 = ["#4CAF7A", "#4A90C9", "#F0625D"];
const COLORS2 = ["#8E6BD1", "#6378D1", "#E68632"];
const DEFAULT_ACTIVITY = {
  meetings: [
    { name: "Scheduled", value: 0 },
    { name: "Conducted", value: 0 },
    { name: "Cancelled", value: 0 }
  ],
  events: [
    { name: "Registered", value: 0 },
    { name: "Attended", value: 0 },
    { name: "Missed", value: 0 }
  ],
  footerStats: {
    meetingRate: 0,
    eventAttendance: 0,
    totalActivities: 0,
    upcoming: 0
  }
};

function Donut({ data = [], colors = [], total = 0 }) {
  return (
    <div className="donut">
      <ResponsiveContainer width={220} height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={index} fill={colors[index]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="donut-center">
        <div className="donut-number">{total}</div>
        <div className="donut-label">Total</div>
      </div>
    </div>
  );
}

function MeetingsEventsPanel({
  activityData,
  range = "month",
  onRangeChange,
  showRangeSelect = true
}) {
  const data = activityData || DEFAULT_ACTIVITY;
  const { meetings = [], events = [], footerStats = {} } = data;
  const totalMeetings = meetings.reduce((acc, item) => acc + (item.value || 0), 0);
  const totalEvents = events.reduce((acc, item) => acc + (item.value || 0), 0);

  return (
    <div className="activity-card">
      <div className="activity-header">
        <h3>Meetings & Events Activity</h3>
        {showRangeSelect ? (
          <select
            className="activity-range-select"
            value={range}
            onChange={(event) => onRangeChange?.(event.target.value)}
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
          </select>
        ) : null}
      </div>

      <div className="activity-body">
        <div className="activity-col">
          <h4>Meetings</h4>
          <Donut data={meetings} colors={COLORS1} total={totalMeetings} />

          <div className="legend">
            {meetings.map((item, index) => (
              <div key={item.name || index} className="legend-row">
                <span>
                  <i style={{ background: COLORS1[index] }}></i>
                  {item.name}
                </span>
                <b>{item.value}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="activity-col">
          <h4>Events</h4>
          <Donut data={events} colors={COLORS2} total={totalEvents} />

          <div className="legend">
            {events.map((item, index) => (
              <div key={item.name || index} className="legend-row">
                <span>
                  <i style={{ background: COLORS2[index] }}></i>
                  {item.name}
                </span>
                <b>{item.value}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="activity-footer">
        <div>
          <small>Meeting Rate</small>
          <strong>{footerStats.meetingRate || 0}%</strong>
        </div>
        <div>
          <small>Event Attendance</small>
          <strong>{footerStats.eventAttendance || 0}%</strong>
        </div>
        <div>
          <small>Total Activities</small>
          <strong>{footerStats.totalActivities || 0}</strong>
        </div>
      </div>
    </div>
  );
}

export default MeetingsEventsPanel;
