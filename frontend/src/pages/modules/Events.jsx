import React from "react";
import "./styles/Event.css";

const EventExpo = () => {
  return (
    <div className="event-page">
      <div className="event-summary-cards">
        <div className="event-card event-card-accent-blue">
          <h4>Upcoming Events</h4>
          <h2>18</h2>
          <p>Next 6 months</p>
        </div>

        <div className="event-card event-card-accent-green">
          <h4>Registered</h4>
          <h2>5</h2>
          <p>3 attending confirmed</p>
        </div>

        <div className="event-card event-card-accent-orange">
          <h4>Avg ROI per Event</h4>
          <h2>Rs. 8.2L</h2>
          <p>12 leads per event avg</p>
        </div>

        <div className="event-card event-card-accent-purple">
          <h4>Last Updated</h4>
          <h2>2h ago</h2>
          <p>Auto-updates weekly</p>
        </div>
      </div>

      <div className="event-filters">
        <button>Near Me</button>
        <button>High Priority</button>
        <button>This Month</button>
        <button>Registered</button>
      </div>

      <div className="event-section">
        <h3>Upcoming Events & Expos</h3>

        <div className="event-item">
          <div className="event-left">
            <h4>
              Renewable Energy India Expo 2026
              <span className="badge">95 - Must Attend</span>
            </h4>

            <p>Location: India Expo Centre, Greater Noida</p>
            <p>Date: March 15-17, 2026 (3 days)</p>

            <p>
              India's largest renewable energy exhibition. 800+ exhibitors,
              45,000+ attendees.
            </p>

            <div className="event-tags">
              <span>45,000+ attendees</span>
              <span>800+ exhibitors</span>
              <span>Solar, Wind, EV</span>
            </div>

            <div className="event-actions">
              <button className="primary">Register & Attend</button>
              <button>Mark Interested</button>
              <button>Visit Website</button>
            </div>
          </div>

          <div className="event-right">
            <h3>Rs. 25,000</h3>
            <p>Registration fee</p>
          </div>
        </div>
      </div>

      <div className="event-analytics">
        <h3>Event Performance Analytics</h3>

        <div className="analytics-cards">
          <div className="analytics-card">
            <h4>Last Event ROI</h4>
            <h2>Rs. 12.5L</h2>
            <p>18 leads, 2 closed deals</p>
          </div>

          <div className="analytics-card">
            <h4>Best Event Type</h4>
            <h2>Trade Shows</h2>
            <p>38% conversion rate</p>
          </div>

          <div className="analytics-card">
            <h4>Business Cards Scanned</h4>
            <h2>124</h2>
            <p>Auto-imported via OCR</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventExpo;
