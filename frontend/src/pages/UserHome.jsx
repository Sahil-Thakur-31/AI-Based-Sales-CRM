import { useEffect, useState } from "react";
import MeetingsEventsPanel from '../components/MeetingsEventsPanel';
import StatCard from '../components/StatCard';
import '../styles/managerDashboard.css';

function UserHome() {
    const [dashboardData, setDashboardData] = useState(null);

    useEffect(() => {
        // Basic dashboard stats for regular users
        const dummyData = {
            stats: [
                {
                    title: "My Follow-ups Today",
                    value: 4,
                    sub: "2 high priority",
                    icon: "📞",
                    color: "blue"
                },
                {
                    title: "My Active Deals",
                    value: 5,
                    sub: "+1 this week",
                    icon: "💼",
                    color: "green"
                },
                {
                    title: "Monthly Target",
                    value: "₹3.5L",
                    sub: "80% achieved",
                    icon: "🎯",
                    color: "orange"
                },
                {
                    title: "Win Rate",
                    value: "35%",
                    sub: "Keep it up!",
                    icon: "⭐",
                    color: "purple"
                }
            ],
            pipelineValue: "₹12.5L",
            followups: [
                {
                    id: 1,
                    company: "Local Tech Solutions",
                    message: "Follow-up call - Review quotation",
                    time: "10:30 AM",
                    priority: "High"
                },
                {
                    id: 2,
                    company: "Alpha Innovations",
                    message: "Send company profile",
                    time: "2:00 PM",
                    priority: "Medium"
                }
            ],
            insights: [
                {
                    id: 1,
                    type: "Opportunity",
                    message: "Local Tech deal has 75% close probability."
                },
                {
                    id: 2,
                    type: "Action Needed",
                    message: "1 lead hasn't been contacted in 5 days."
                }
            ]
        };

        setDashboardData(dummyData);
    }, []);

    if (!dashboardData) return <p>Loading...</p>;

    return (
        <div className="ManagerDashboard">
            <div className="dashboard container-fluid">
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
                            <h3>🔥 My Priority Follow-ups Today</h3>
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
                            <h3>📊 My Pipeline Value</h3>
                            <div className="pipeline-value">
                                {dashboardData.pipelineValue}
                            </div>
                        </div>

                        <div className="panel">
                            <h3>📈 AI Insights</h3>
                            {dashboardData.insights.map((insight) => (
                                <div key={insight.id} className="insight">
                                    <strong>{insight.type}</strong>
                                    <p>{insight.message}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default UserHome;
