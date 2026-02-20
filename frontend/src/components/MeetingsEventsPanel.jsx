import {
  PieChart, Pie, Cell, ResponsiveContainer
} from "recharts";
import { useEffect, useState } from "react";
import '../styles/meetingsPanel.css';

const COLORS1 = ["#4CAF7A","#4A90C9","#F0625D"];
const COLORS2 = ["#8E6BD1","#6378D1","#E68632"];

function Donut({ data = [], colors = [], total = 0 }) {
  return (
    <div className="donut">
      <ResponsiveContainer width={220} height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={70}
            outerRadius={100}
            paddingAngle={2}
          >
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

function MeetingsEventsPanel(){

  const [activityData, setActivityData] = useState(null);

  useEffect(() => {

    // 🔹 Dummy data (replace with backend later)
    const dummyData = {
      meetings: [
        { name: "Scheduled", value: 15 },
        { name: "Conducted", value: 21 },
        { name: "Cancelled", value: 6 },
      ],
      events: [
        { name: "Registered", value: 8 },
        { name: "Attended", value: 9 },
        { name: "Missed", value: 3 },
      ],
      footerStats: {
        meetingRate: "83%",
        eventAttendance: "85%",
        totalActivities: 62,
        upcoming: 23
      }
    };

    // 🔹 Future backend API
    // fetch("http://localhost:5000/api/activity")
    //   .then(res => res.json())
    //   .then(data => setActivityData(data))
    //   .catch(err => console.error(err));

    setActivityData(dummyData);

  }, []);

  if (!activityData) return <p>Loading...</p>;

  const { meetings, events, footerStats } = activityData;

  const totalMeetings = meetings.reduce((a,b)=>a+b.value,0);
  const totalEvents = events.reduce((a,b)=>a+b.value,0);

  return(
    <div className="activity-card">

      <div className="activity-header">
        <h3>📊 Meetings & Events Activity</h3>
        <select>
          <option>This Month</option>
          <option>Last Month</option>
          <option>Last 3 Months</option>
          <option>Last 6 Months</option>
        </select>
      </div>

      <div className="activity-body">

        {/* LEFT MEETINGS */}
        <div className="activity-col">
          <h4>📞 Meetings</h4>
          <Donut data={meetings} colors={COLORS1} total={totalMeetings} />

          <div className="legend">
            {meetings.map((m,i)=>(
              <div key={i} className="legend-row">
                <span>
                  <i style={{background:COLORS1[i]}}></i>
                  {m.name}
                </span>
                <b>{m.value}</b>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT EVENTS */}
        <div className="activity-col">
          <h4>🏟 Events</h4>
          <Donut data={events} colors={COLORS2} total={totalEvents} />

          <div className="legend">
            {events.map((m,i)=>(
              <div key={i} className="legend-row">
                <span>
                  <i style={{background:COLORS2[i]}}></i>
                  {m.name}
                </span>
                <b>{m.value}</b>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* FOOTER STATS */}
      <div className="activity-footer">
        <div>
          <small>Meeting Rate</small>
          <strong>{footerStats.meetingRate}</strong>
        </div>
        <div>
          <small>Event Attendance</small>
          <strong>{footerStats.eventAttendance}</strong>
        </div>
        <div>
          <small>Total Activities</small>
          <strong>{footerStats.totalActivities}</strong>
        </div>
        <div>
          <small>Upcoming</small>
          <strong>{footerStats.upcoming}</strong>
        </div>
      </div>

    </div>
  );
}

export default MeetingsEventsPanel;
