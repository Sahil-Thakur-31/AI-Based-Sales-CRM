import React from "react";
import "./ExpenseDashboard.css";

const ExpenseDashboard = () => {
  const expenses = [
    { id: 1, title: "Client Meeting", amount: 2500, status: "Approved" },
    { id: 2, title: "Travel Expense", amount: 1200, status: "Pending" },
    { id: 3, title: "Demo Setup", amount: 1800, status: "Approved" }
  ];

  const total = 12450;
  const approved = 9200;
  const pending = 3250;
  const revenue = 580000;
  const ratio = ((total / revenue) * 100).toFixed(2);

  return (
    <div className="container">

      {/* Header */}
      <div className="header">
        <h1>Expense Management</h1>
        <div className="profile">RS</div>
      </div>

      {/* KPI Cards */}
      <div className="cards">
        <div className="card">
          <h4>This Month's Expenses</h4>
          <h2>₹{total}</h2>
          <p>8 Transactions</p>
        </div>

        <div className="card approved">
          <h4>Approved</h4>
          <h2>₹{approved}</h2>
          <p>6 Transactions</p>
        </div>

        <div className="card pending">
          <h4>Pending Approval</h4>
          <h2>₹{pending}</h2>
          <p>2 Transactions</p>
        </div>
      </div>

      {/* Ratio Card */}
      <div className="card ratio">
        <h4>Expense / Revenue Ratio</h4>
        <h2>{ratio}%</h2>
        <p>Below target (3%)</p>
      </div>

      {/* Recent Expenses Table */}
      <div className="recent-expenses">
        <h3>Recent Expenses</h3>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((exp) => (
              <tr key={exp.id}>
                <td>{exp.title}</td>
                <td>₹{exp.amount}</td>
                <td className={
                  exp.status === "Approved"
                    ? "status-approved"
                    : "status-pending"
                }>
                  {exp.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default ExpenseDashboard;
