import React from "react";
import "./SalesForecasting.css";

const SalesForecasting = () => {
  const pipelineData = [
    {
      stage: "New Leads",
      value: "₹5.2L",
      deals: 4,
      items: [
        { name: "Pune Solar Solutions", amount: "₹2.5L" },
        { name: "Mumbai Energy Corp", amount: "₹1.8L" },
      ],
    },
    {
      stage: "Qualification",
      value: "₹8.5L",
      deals: 3,
      items: [
        { name: "Tech Manufacturing", amount: "₹4.2L" },
        { name: "Solar Innovations", amount: "₹3.1L" },
      ],
    },
    {
      stage: "Proposal",
      value: "₹22.3L",
      deals: 5,
      items: [
        { name: "Enertech Manufacturing", amount: "₹15.5L" },
        { name: "GreenEnergy Solutions", amount: "₹8.2L" },
      ],
    },
    {
      stage: "Negotiation",
      value: "₹12.8L",
      deals: 3,
      items: [
        { name: "SolarTech Industries", amount: "₹12.5L" },
      ],
    },
    {
      stage: "Closing",
      value: "₹2.2L",
      deals: 1,
      items: [
        { name: "Delhi Solar", amount: "₹2.2L" },
      ],
    },
  ];

  return (
    <div className="forecast-container">
     

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <h3>₹45.8L</h3>
          <p>Total Pipeline Value</p>
          <span className="positive">12 active deals</span>
        </div>

        <div className="kpi-card">
          <h3>42%</h3>
          <p>Expected Win Rate</p>
          <span className="positive">Based on AI analysis</span>
        </div>

        <div className="kpi-card">
          <h3>₹19.2L</h3>
          <p>Forecast Revenue</p>
          <span className="positive">Next 30 days</span>
        </div>

        <div className="kpi-card">
          <h3>18 days</h3>
          <p>Avg. Sales Cycle</p>
          <span className="positive">-3 days from last month</span>
        </div>
      </div>

      {/* Sales Pipeline */}
      <div className="pipeline-section">
        <h3>Sales Pipeline</h3>

        <div className="pipeline-grid">
          {pipelineData.map((stage, index) => (
            <div key={index} className="pipeline-card">
              <div className="stage-header">
                <h4>{stage.stage}</h4>
                <h5>{stage.value}</h5>
                <p>{stage.deals} deals</p>
              </div>

              {stage.items.map((item, i) => (
                <div key={i} className="deal-card">
                  <span>{item.name}</span>
                  <strong>{item.amount}</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SalesForecasting;