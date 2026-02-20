import { useEffect, useState } from "react";
import MeetingsEventsPanel from '../components/MeetingsEventsPanel';
import StatCard from '../components/StatCard';
import '../styles/dashboard.css';

function Dashboard() {

  const [dashboardData, setDashboardData] = useState(null);

  useEffect(() => {
    // forr now dummy data
    const dummyData = {
      stats: [
        {
          title: "Today's Follow-ups",
          value: 8,
          sub: "3 high priority",
          // badge: "AI",
          icon: "📞",
          color: "blue"
        },
        {
          title: "Active Deals",
          value: 12,
          sub: "+2 this week",
          icon: "💼",
          color: "green"
        },
        {
          title: "Monthly Target",
          value: "₹8.5L",
          sub: "68% achieved (₹5.78L)",
          icon: "🎯",
          color: "orange"
        },
        {
          title: "Win Rate",
          value: "42%",
          sub: "Above team avg (38%)",
          icon: "⭐",
          color: "purple"
        }
      ],
      pipelineValue: "₹45.8L",
      
      //aatta sathi
      followups: [
    {
      id: 1,
      company: "SolarTech Industries",
      message: "Follow-up call - Proposal discussion",
      time: "9:00 AM",
      priority: "High"
    },
    {
      id: 2,
      company: "GreenEnergy Solutions",
      message: "Send revised quotation",
      time: "11:00 AM",
      priority: "Medium"
    }
  ],

  insights: [
    {
      id: 1,
      type: "Opportunity",
      message: "SolarTech deal has 85% close probability."
    },
    {
      id: 2,
      type: "Risk",
      message: "3 leads haven't been contacted in 7+ days."
    }
  ]
    };

    // nantar replace karaaych:
    // fetch("http://localhost:5000/api/dashboard")
    //   .then(res => res.json())
    //   .then(data => setDashboardData(data));
    //   .catch(err => console.error(err));

    setDashboardData(dummyData);

  }, []);

  if (!dashboardData) return <p>Loading...</p>;

  return (
    <div className="dashboard container-fluid">

      <Topbar />

      {/* STATS ROW */}
      <div className="row g-4 mt-2">
        {dashboardData.stats.map((stat, i) => (
          <div key={i} className="col-12 col-sm-6 col-lg-3">
            <StatCard {...stat} />
          </div>
        ))}
      </div>

      {/* MEETINGS PANEL */}
      <div className="row mt-4">
        <div className="col-12">
          <div className="panel">
            <MeetingsEventsPanel />
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION */}
      <div className="row mt-4">

        {/* LEFT */}
        <div className="col-12 col-lg-8">
              <div className="panel">
  <h3>🔥 Priority Follow-ups Today</h3>

  {dashboardData.followups.map((item) => (
    <div key={item.id} className="follow-item">
      <div>
        <strong>{item.company}</strong>
        <p>{item.message}</p>
      </div>
      <div className="text-end">
        <small>{item.time}</small>
        <div>{item.priority}</div>
      </div>
    </div>
  ))}

</div>

        </div>

        {/* RIGHT */}
        <div className="col-12 col-lg-4">
          <div className="panel mb-4">
            <h3>📊 Pipeline Value</h3>
            <div className="pipeline-value">
              {dashboardData.pipelineValue}
            </div>
          </div>

          <div className="panel">
            <h3>📈 AI Insights</h3>

            {dashboardData.insights.map((insight) => (
               <div key={insight.id}       className="insight">
              <strong>{insight.type}</strong>
             <p>{insight.message}</p>
             </div>
           ))}

           </div>

        </div>

      </div>

    </div>
  );
}

export default Dashboard;
