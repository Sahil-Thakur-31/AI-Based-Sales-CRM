import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import API from "../../api";
import "./styles/Expense.css";

const categories = ["Travel", "Client Meeting", "Event", "Marketing"];

const ExpenseDashboard = () => {
  const [selectedUser, setSelectedUser] = useState("All Users");
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [usersList, setUsersList] = useState(["All Users"]);
  const [currentUser, setCurrentUser] = useState(null); // 👈 NEW

  const [formData, setFormData] = useState({
    category: "Travel",
    date: "",
    amount: "",
    gst: "",
    total: "",
    description: "",
  });

  /* ================= FETCH CURRENT USER ================= */
  const fetchCurrentUser = async () => {
    try {
      const { data } = await API.get("/users/me");
      setCurrentUser(data);
    } catch (err) {
      console.error("Fetch current user error:", err);
    }
  };

  /* ================= FETCH EXPENSES ================= */
  const fetchExpenses = async () => {
    try {
      const { data } = await API.get("/api/expenses");

      const formatted = data.map((exp) => ({
        id: exp._id,
        category: exp.category,
        user: exp.userId?.name || "Unknown",
        amount: exp.amount,
        gst: exp.gstAmount,
        total: exp.totalAmount,
        date: exp.expenseDate?.split("T")[0],
        status: exp.approval?.status || "pending",
        description: exp.description,
      }));

      setExpenses(formatted);
    } catch (err) {
      console.error(err);
    }
  };

  /* ================= FETCH USERS ================= */
  const fetchUsers = async () => {
    try {
      const { data } = await API.get("/users");

      const users = ["All Users", ...data.map((user) => user.name)];
      setUsersList(users);
    } catch (err) {
      console.error("Users fetch error:", err);
    }
  };

  useEffect(() => {
    fetchCurrentUser();  // 👈 fetch user first
    fetchExpenses();
    fetchUsers();
  }, []);

  /* ================= FILTER USERS ================= */
  const filteredUsers = usersList.filter((user) =>
    user.toLowerCase().includes(search.toLowerCase())
  );

  const filteredExpenses =
    selectedUser === "All Users"
      ? expenses
      : expenses.filter((exp) => exp.user === selectedUser);

  /* ================= SUMMARY ================= */
  const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.total, 0);
  const totalGST = filteredExpenses.reduce((sum, e) => sum + e.gst, 0);

  const approved = filteredExpenses.filter((e) => e.status === "approved");
  const pending = filteredExpenses.filter((e) => e.status === "pending");

  /* ================= CATEGORY SUMMARY ================= */
  const categorySummary = categories.map((cat) => {
    const total = filteredExpenses
      .filter(
        (e) => e.category === cat.toLowerCase().replace(" ", "_")
      )
      .reduce((sum, e) => sum + e.total, 0);

    return { category: cat, total };
  });

  const maxCategory = Math.max(...categorySummary.map((c) => c.total), 1);

  /* ================= USER SUMMARY ================= */
  const userSummary = usersList
    .filter((u) => u !== "All Users")
    .map((user) => {
      const total = filteredExpenses
        .filter((e) => e.user === user)
        .reduce((sum, e) => sum + e.total, 0);

      return { user, total };
    });

  const maxUser = Math.max(...userSummary.map((u) => u.total), 1);

  /* ================= FORM ================= */
  const handleChange = (e) => {
    const { name, value } = e.target;
    let updated = { ...formData, [name]: value };

    if (name === "amount") {
      const gst = (value * 18) / 100;
      updated.gst = gst;
      updated.total = Number(value) + gst;
    }

    setFormData(updated);
  };

  /* ================= CREATE ================= */
  const handleAddExpense = async () => {
    if (!currentUser) {
      alert("User not loaded yet");
      return;
    }

    if (!formData.amount || !formData.date) {
      alert("Fill required fields");
      return;
    }

    const payload = {
      userId: currentUser._id,
      referenceId: currentUser._id,
      referenceType: "Lead",
      category: formData.category.toLowerCase().replace(" ", "_"),
      amount: Number(formData.amount),
      gstAmount: Number(formData.gst),
      totalAmount: Number(formData.total),
      expenseDate: formData.date,
      receipt: {
        fileUrl: "dummy-url",
      },
      description: formData.description,
    };

    try {
      await API.post("/api/expenses", payload);
      fetchExpenses();
      setShowLogModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  /* ================= DELETE ================= */
  const handleDelete = async (id) => {
    try {
      await API.delete(`/api/expenses/${id}`);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleView = (expense) => {
    alert(JSON.stringify(expense, null, 2));
  };

  return (
    <div className="expense-dashboard">

      {/* ================= CARDS ================= */}
      <div className="expense-cards">
        <div className="expense-card green">
          <h4>Total</h4>
          <h2>₹{totalAmount}</h2>
          <p>Filtered View</p>
        </div>

        <div className="expense-card blue">
          <h4>Approved</h4>
          <h2>₹{approved.reduce((s, e) => s + e.total, 0)}</h2>
          <p>{approved.length} expenses</p>
        </div>

        <div className="expense-card orange">
          <h4>Pending</h4>
          <h2>₹{pending.reduce((s, e) => s + e.total, 0)}</h2>
          <p>{pending.length} awaiting</p>
        </div>

        <div className="expense-card pink">
          <h4>GST</h4>
          <h2>₹{totalGST}</h2>
          <p>Claimable</p>
        </div>
      </div>

      {/* ================= MIDDLE SECTION ================= */}
      <div className="expense-middle-section">
        <div className="expense-box">
          <h3>By Category</h3>
          {categorySummary.map((item, i) => (
            <div key={i}>
              <div className="expense-progress-item">
                <span>{item.category}</span>
                <span>₹{item.total}</span>
              </div>
              <div className="expense-progress">
                <div
                  className="expense-bar green"
                  style={{
                    width: `${(item.total / maxCategory) * 100}%`,
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>

        <div className="expense-box">
          <h3>By User</h3>
          {userSummary.map((item, i) => (
            <div key={i}>
              <div className="expense-user-row">
                <span>{item.user}</span>
                <span>₹{item.total}</span>
              </div>
              <div className="expense-progress">
                <div
                  className="expense-bar blue"
                  style={{
                    width: `${(item.total / maxUser) * 100}%`,
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ================= LEDGER ================= */}
      <div className="expense-ledger">
        <div className="expense-ledger-header">
          <h3>Expense Ledger</h3>

          <div className="expense-ledger-actions">
            <div className="expense-dropdown">
              <div
                className="expense-dropdown-selected"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                {selectedUser} ▼
              </div>

              {showDropdown && (
                <div className="expense-dropdown-menu">
                  <input
                    className="app-search-input expense-dropdown-search"
                    type="text"
                    placeholder="Search user..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {filteredUsers.map((user, i) => (
                    <div
                      key={i}
                      className="expense-dropdown-item"
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

            <button
              className="expense-ocr-btn"
              onClick={() => setShowModal(true)}
            >
              OCR
            </button>

            <button
              className="expense-log-btn"
              onClick={() => setShowLogModal(true)}
            >
              + Log Expense
            </button>
          </div>
        </div>

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
            {filteredExpenses.map((exp) => (
              <tr key={exp.id}>
                <td>{exp.category}</td>
                <td>{exp.user}</td>
                <td>₹{exp.amount}</td>
                <td>₹{exp.gst}</td>
                <td>₹{exp.total}</td>
                <td>{exp.date}</td>
                <td>
                  <span
                    className={
                      exp.status === "approved"
                        ? "expense-approved"
                        : "expense-pending"
                    }
                  >
                    {exp.status}
                  </span>
                </td>
                <td>
                  <button
                    className="expense-view"
                    onClick={() => handleView(exp)}
                  >
                    View
                  </button>
                  <button
                    className="expense-delete"
                    onClick={() => handleDelete(exp.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ================= OCR MODAL ================= */}
      {showModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-large-modal">
              <div className="expense-modal-header">
                <h3>OCR Expense Import</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => setShowModal(false)}
                >
                  ✖
                </span>
              </div>

              <div className="expense-upload-box">
                <input type="file" />
                <p>Drop file or click to upload</p>
                <span>Supports: JPG, PNG, PDF</span>

                <div className="expense-ai-section">
                  <button className="expense-ai-btn">
                    + AI OCR Processing
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ================= LOG MODAL ================= */}
      {showLogModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-log-modal">
              <div className="expense-modal-header">
                <h3>Log Expense</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => setShowLogModal(false)}
                >
                  ✖
                </span>
              </div>

              <div className="expense-form-grid">
                <div className="expense-form-group">
                  <label>Category</label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                  >
                    {categories.map((c, i) => (
                      <option key={i}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="expense-form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                  />
                </div>

                <div className="expense-form-group">
                  <label>Amount</label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                  />
                </div>

                <div className="expense-form-group">
                  <label>GST</label>
                  <input
                    type="number"
                    name="gst"
                    value={formData.gst}
                    readOnly
                  />
                </div>

                <div className="expense-form-group expense-full-width">
                  <label>Total</label>
                  <input
                    type="number"
                    name="total"
                    value={formData.total}
                    readOnly
                  />
                </div>

                <div className="expense-form-group expense-full-width">
                  <label>Description</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="expense-modal-footer">
                <button
                  className="expense-cancel-btn"
                  onClick={() => setShowLogModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="expense-submit-btn"
                  onClick={handleAddExpense}
                >
                  💾 Log Expense
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

    </div>
  );
};

export default ExpenseDashboard;
