

// import MeetingsEventsPanel from '../components/MeetingsEventsPanel';

// import Topbar from '../components/Topbar';
// import StatCard from '../components/StatCard';
// import '../styles/dashboard.css';

// function Dashboard(){

//   // 🔹 TEMP FAKE DATABASE DATA
//   const dashboardData = {
//     stats: [
//       {
//         title: "Today's Follow-ups",
//         value: 8,
//         sub: "3 high priority",
//         badge: "AI",
//         icon: "📞",
//         color: "blue"
//       },
//       {
//         title: "Active Deals",
//         value: 12,
//         sub: "+2 this week",
//         icon: "💼",
//         color: "green"
//       },
//       {
//         title: "Monthly Target",
//         value: "₹8.5L",
//         sub: "68% achieved (₹5.78L)",
//         icon: "🎯",
//         color: "orange"
//       },
//       {
//         title: "Win Rate",
//         value: "42%",
//         sub: "Above team avg (38%)",
//         icon: "⭐",
//         color: "purple"
//       }
//     ],

//     pipelineValue: "₹45.8L",

//     insights: [
//       "🚀 Opportunity Alert",
//       "⚠ Risk Alert",
//       "✅ Best Practice"
//     ]
//   };

//   return(
//     <div className="dashboard">

//       <Topbar />

//       {/* Top Stats */}
//       <div className="stats-grid">
//         {dashboardData.stats.map((stat, i) => (
//           <StatCard key={i} {...stat} />
//         ))}
//       </div>

//       {/* Main Sections */}
//       <div className="main-panels">

//         <div className="panel big">
          
//           <MeetingsEventsPanel/>
//         </div>

//         <div className="bottom-grid">

//   {/* LEFT — FOLLOWUPS */}
//   <div className="panel followups">

//     <div className="panel-header">
//       <h3>🔥 Priority Follow-ups Today</h3>
//       <span className="view">View All</span>
//     </div>

//     {[
//       {
//         name:"SolarTech Industries",
//         text:"📞 Follow-up call - Proposal discussion (High value: ₹12.5L)",
//         time:"9:00 AM",
//         tag:"AI Suggested",
//         color:"red"
//       },
//       {
//         name:"GreenEnergy Solutions",
//         text:"📄 Send revised quotation - Decision pending",
//         time:"11:00 AM",
//         color:"red"
//       },
//       {
//         name:"Enertech Manufacturing",
//         text:"💬 WhatsApp check-in - Demo feedback",
//         time:"2:00 PM",
//         color:"orange"
//       },
//       {
//         name:"Delhi Solar Corp",
//         text:"📅 Call to schedule demo - Lead going cold",
//         time:"4:30 PM",
//         tag:"AI Suggested",
//         color:"blue"
//       }
//     ].map((f,i)=>(
//       <div key={i} className={`follow-item ${f.color}`}>
//         <div>
//           <strong>{f.name}</strong>
//           <p>{f.text}</p>
//         </div>

//         <div className="right">
//           <small>{f.time}</small>
//           {f.tag && <span className="badge">{f.tag}</span>}
//         </div>
//       </div>
//     ))}

//   </div>


//   {/* RIGHT SIDE */}
//   <div className="right-stack">

//     {/* PIPELINE */}
//     <div className="panel pipeline">

//       <h3>📊 Pipeline Value</h3>

//       <div className="pipeline-value">₹45.8L</div>
//       <p className="sub">Across 12 active deals</p>

//       <div className="pipeline-grid">
//         <div><small>Qualification</small><b>₹8.5L (3)</b></div>
//         <div><small>Proposal</small><b>₹22.3L (5)</b></div>
//         <div><small>Negotiation</small><b>₹12.8L (3)</b></div>
//         <div><small>Closing</small><b>₹2.2L (1)</b></div>
//       </div>

//     </div>


//     {/* AI INSIGHTS */}
//     <div className="panel insights-card">

//       <h3>📈 AI Insights</h3>

//       <div className="insight purple">
//         💡 Opportunity Alert
//         <p>SolarTech deal has 85% close probability. Schedule final meeting ASAP!</p>
//       </div>

//       <div className="insight red">
//         ⚠ Risk Alert
//         <p>3 leads haven't been contacted in 7+ days. Risk of going cold.</p>
//       </div>

//       <div className="insight green">
//         ✨ Best Practice
//         <p>Your response time is 40% faster than team average. Great work!</p>
//       </div>

//     </div>

//   </div>

// </div>


//       </div>

//     </div>
//   )
// }

// export default Dashboard;



import { useEffect, useState } from "react";
import MeetingsEventsPanel from '../components/MeetingsEventsPanel';
import Topbar from '../components/Topbar';
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
