import React, { useState } from "react";
import "../../styles/Expense.css";

const usersList = [
  "All Users",
  "Anil Sharma",
  "Priya Mehta",
  "Karan Singh",
  "Neha Roy",
];

const ExpenseDashboard = () => {
  const [selectedUser, setSelectedUser] = useState("All Users");
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  const filteredUsers = usersList.filter((user) =>
    user.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="dashboard">
      {/* ================= TOP SECTION (UNCHANGED) ================= */}
      <div className="cards">
        <div className="card green">
          <h4>Total</h4>
          <h2>₹1.0L</h2>
          <p>Q1 2025</p>
        </div>

        <div className="card blue">
          <h4>Approved</h4>
          <h2>₹80K</h2>
          <p>4 expenses</p>
        </div>

        <div className="card orange">
          <h4>Pending</h4>
          <h2>₹24K</h2>
          <p>2 awaiting</p>
        </div>

        <div className="card pink">
          <h4>GST</h4>
          <h2>₹16K</h2>
          <p>Claimable</p>
        </div>
      </div>

      {/* ================= MIDDLE SECTION (UNCHANGED) ================= */}
      <div className="middle-section">
        <div className="box">
          <h3>By Category</h3>

          <div className="progress-item">
            <span>Client Meeting</span>
            <span>₹9K</span>
          </div>
          <div className="progress">
            <div style={{ width: "25%" }} className="bar green"></div>
          </div>

          <div className="progress-item">
            <span>Travel</span>
            <span>₹15K</span>
          </div>
          <div className="progress">
            <div style={{ width: "40%" }} className="bar blue"></div>
          </div>

          <div className="progress-item">
            <span>Event</span>
            <span>₹41K</span>
          </div>
          <div className="progress">
            <div style={{ width: "70%" }} className="bar orange"></div>
          </div>

          <div className="progress-item">
            <span>Marketing</span>
            <span>₹30K</span>
          </div>
          <div className="progress">
            <div style={{ width: "60%" }} className="bar purple"></div>
          </div>
        </div>

        <div className="box">
          <h3>By User</h3>

          <div className="user-row">
            <span>Anil Sharma</span>
            <span>₹34K</span>
          </div>
          <div className="progress">
            <div style={{ width: "50%" }} className="bar green"></div>
          </div>

          <div className="user-row">
            <span>Priya Mehta</span>
            <span>₹15K</span>
          </div>
          <div className="progress">
            <div style={{ width: "30%" }} className="bar blue"></div>
          </div>

          <div className="user-row">
            <span>Karan Singh</span>
            <span>₹46K</span>
          </div>
          <div className="progress">
            <div style={{ width: "75%" }} className="bar orange"></div>
          </div>
        </div>
      </div>

      {/* ================= EXPENSE LEDGER ================= */}
      <div className="ledger">
        <div className="ledger-header">
          <h3>Expense Ledger</h3>

          <div className="ledger-actions">
            {/* Dropdown */}
            <div className="dropdown">
              <div
                className="dropdown-selected"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                {selectedUser} ▼
              </div>

              {showDropdown && (
                <div className="dropdown-menu">
                  <input
                    type="text"
                    placeholder="Search user..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  {filteredUsers.map((user, i) => (
                    <div
                      key={i}
                      className="dropdown-item"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowDropdown(false);
                      }}
                    >
                      {user}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="ocr-btn" onClick={() => setShowModal(true)}>
              OCR
            </button>

            <button className="log-btn" onClick={() => setShowLogModal(true)}>
              + Log Expense
            </button>
          </div>
        </div>

        {/* TABLE (UNCHANGED) */}
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>User</th>
              <th>Amount</th>
              <th>GST</th>
              <th>Total</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>Client Meeting</td>
              <td>Anil Sharma</td>
              <td>₹4K</td>
              <td>₹756</td>
              <td>₹5K</td>
              <td>15 Mar 2025</td>
              <td>
                <span className="approved">Approved</span>
              </td>
              <td>
                <button className="view">View</button>
                <button className="delete">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ================= OCR MODAL ================= */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal large-modal">
            <div className="modal-header">
              <h3>OCR Expense Import</h3>
              <span className="close-btn" onClick={() => setShowModal(false)}>
                ✖
              </span>
            </div>

            <div className="upload-box">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                onChange={(e) => console.log(e.target.files[0])}
              />

              <p>Drop file or click to upload</p>
              <span>Supports: JPG, PNG, PDF</span>

              <div className="ai-section">
                <button className="ai-btn">+ AI OCR Processing</button>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

{/* ================= Add Log Expense ================= */}
      {showLogModal && (
        <div className="modal-overlay">
          <div className="modal log-modal">
            <div className="modal-header">
              <h3>Log Expense</h3>
              <span
                className="close-btn"
                onClick={() => setShowLogModal(false)}
              >
                ✖
              </span>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Category</label>
                <select>
                  <option>Travel</option>
                  <option>Client Meeting</option>
                  <option>Event</option>
                  <option>Marketing</option>
                </select>
              </div>

              <div className="form-group">
                <label>Date</label>
                <input type="date" />
              </div>

              <div className="form-group">
                <label>Amount (₹)</label>
                <input type="number" placeholder="0" />
              </div>

              <div className="form-group">
                <label>GST (Auto 18%)</label>
                <input type="number" placeholder="0" />
              </div>

              <div className="form-group full-width">
                <label>Total (₹)</label>
                <input type="number" placeholder="0" />
              </div>

              <div className="form-group full-width">
                <label>Vendor / Description</label>
                <textarea placeholder="e.g. Client lunch at Taj Hotel, Mumbai"></textarea>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="cancel-btn"
                onClick={() => setShowLogModal(false)}
              >
                Cancel
              </button>
              <button className="submit-btn">💾 Log Expense</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseDashboard;
