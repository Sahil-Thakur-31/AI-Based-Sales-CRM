import React from "react";
import "./Expense.css";

const ExpensePage = () => {
  return (
    <div className="expense-container">
      
      {/* Header */}
      <div className="expense-header">
        <h2>Expense Management</h2>
        <div className="profile-box">
          <span>Rahul Sharma</span>
          <div className="avatar">RS</div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="card monthly">
          <h4>This Month's Expenses</h4>
          <h2>₹12,450</h2>
          <p>8 transactions</p>
        </div>

        <div className="card approved">
          <h4>Approved</h4>
          <h2>₹9,200</h2>
          <p>6 transactions</p>
        </div>

        <div className="card pending">
          <h4>Pending Approval</h4>
          <h2>₹3,250</h2>
          <p>2 transactions</p>
        </div>

        <div className="card ratio">
          <h4>Expense/Revenue Ratio</h4>
          <h2>2.15%</h2>
          <p>Below target (3%)</p>
        </div>
      </div>

      <div className="expense-body">
        
        {/* Left Side - Form */}
        <div className="expense-form">
          <h3>Add New Expense</h3>

          <div className="ocr-box">
            <p><strong>Quick OCR Upload</strong></p>
            <p className="small-text">
              Snap a photo of your receipt and AI will automatically fill the form!
            </p>
            <div className="btn-group">
              <button className="btn primary">Capture Receipt</button>
              <button className="btn secondary">Upload Image</button>
            </div>
          </div>

          <label>Expense Category</label>
          <select>
            <option>Select category...</option>
            <option>Client Meeting</option>
            <option>Travel</option>
            <option>Marketing</option>
          </select>

          <label>Amount (₹)</label>
          <input type="number" placeholder="0.00" />

          <label>Link to Deal (Optional)</label>
          <select>
            <option>Select deal...</option>
          </select>

          <label>Description</label>
          <textarea placeholder="Brief description of expense..."></textarea>

          <label>Upload Bill (Photo/PDF)</label>
          <input type="file" />

          <div className="form-buttons">
            <button className="btn primary">Submit for Approval</button>
            <button className="btn secondary">Clear</button>
          </div>
        </div>

        {/* Right Side */}
        
      </div>

    </div>
  );
};

export default ExpensePage;
