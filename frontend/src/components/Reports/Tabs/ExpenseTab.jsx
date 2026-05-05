import React from "react";

function ExpenseTab() {
  return (
    <div className="expense-tab">

      {/* 🟣 KPI CARDS */}
      <section className="kpi-grid">
        <div className="kpi-card">₹10,00,000 <span>Total Expense</span></div>
        <div className="kpi-card">₹25,00,000 <span>Revenue</span></div>
        <div className="kpi-card">₹15,00,000 <span>Profit</span></div>
        <div className="kpi-card">₹20,000 <span>Cost / Deal</span></div>
        <div className="kpi-card positive">+8% <span>Growth</span></div>
      </section>

      {/* 🔵 EXPENSE TREND */}
      <section className="reports-card">
        <h2 className="reports-card-title">Expense Trend</h2>
        <div className="chart-box">📉 Expense Trend Chart (dummy)</div>
      </section>

      {/* 🟢 EXPENSE BREAKDOWN */}
      <section className="reports-card">
        <h2 className="reports-card-title">Expense Breakdown</h2>

        <div className="mini-card">
          <p>Travel → ₹3L (30%)</p>
          <p>Events → ₹5L (50%)</p>
          <p>Marketing → ₹2L (20%)</p>
        </div>
      </section>

      {/* 🟡 EXPENSE VS REVENUE */}
      <section className="reports-card">
        <h2 className="reports-card-title">Expense vs Revenue</h2>

        <div className="split-grid">
          <div className="mini-card">Revenue → ₹25L</div>
          <div className="mini-card">Expense → ₹10L</div>
          <div className="mini-card">Profit → ₹15L</div>
        </div>
      </section>

      {/* 🟠 CATEGORY ANALYSIS */}
      <section className="reports-card">
        <h2 className="reports-card-title">Category ROI</h2>

        <div className="mini-card">
          <p>Events → Spend ₹5L → Revenue ₹12L</p>
          <p className="warning">Travel → Spend ₹3L → Revenue ₹2L</p>
        </div>
      </section>

      {/* 🔵 USER SPENDING */}
      <section className="reports-card">
        <h2 className="reports-card-title">User Spending</h2>

        <div className="mini-card">
          <p>User A → ₹4L</p>
          <p>User B → ₹3L</p>
          <p>User C → ₹1L</p>
        </div>
      </section>

      {/* 🟣 ROI ANALYSIS */}
      <section className="reports-card">
        <h2 className="reports-card-title">ROI Analysis</h2>

        <div className="mini-card">
          <p>Total Expense → ₹10L</p>
          <p>Total Revenue → ₹25L</p>
          <p className="positive">ROI → 2.5x</p>
        </div>
      </section>

      {/* 🟡 APPROVAL */}
      <section className="reports-card">
        <h2 className="reports-card-title">Approval Status</h2>

        <div className="mini-card">
          <p>Pending → 5</p>
          <p>Approved → 50</p>
          <p className="warning">Rejected → 3</p>
        </div>
      </section>

      {/* 🔴 ANOMALY */}
      <section className="reports-card">
        <h2 className="reports-card-title">Unusual Expenses</h2>

        <div className="mini-card">
          <p className="warning">₹1L travel expense by User B</p>
          <p className="warning">Event cost doubled this month</p>
        </div>
      </section>

      {/* 🟣 AI INSIGHTS */}
      <section className="reports-card">
        <h2 className="reports-card-title">AI Insights</h2>

        <div className="ai-box">
          <p>⚠️ Travel expenses too high</p>
          <p>🚀 Events generating strong ROI</p>
          <p>💡 Reduce travel, increase event budget</p>
        </div>
      </section>

    </div>
  );
}

export default ExpenseTab;