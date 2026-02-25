import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import API from "../../api";
import "./styles/Expense.css";

const categories = [
  { label: "Travel", value: "travel" },
  { label: "Client Meeting", value: "client_meeting" },
  { label: "Marketing", value: "marketing" },
  { label: "Event", value: "event" },
  { label: "Other Expense", value: "other" },
];

const ExpenseDashboard = () => {
  const [selectedUser, setSelectedUser] = useState("All Users");
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [usersList, setUsersList] = useState(["All Users"]);
  const [currentUser, setCurrentUser] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [viewingExpense, setViewingExpense] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [formData, setFormData] = useState({
    category: "travel",
    otherCategory: "",
    referenceType: "Lead",
    date: "",
    total: "",
    description: "",
  });

  const roleName = String(currentUser?.role?.name || localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdmin = roleName === "admin";

  const resetForm = () => {
    setFormData({
      category: "travel",
      otherCategory: "",
      referenceType: "Lead",
      date: "",
      total: "",
      description: "",
    });
    setEditingExpense(null);
    setReceiptFile(null);
  };

  const fetchCurrentUser = async () => {
    try {
      const { data } = await API.get("/users/me");
      setCurrentUser(data);
    } catch (err) {
      console.error("Fetch current user error:", err);
    }
  };

  const fetchExpenses = async () => {
    try {
      const { data } = await API.get("/api/expenses");

      const formatted = data.map((exp) => ({
        id: exp._id,
        category: exp.category,
        otherCategory: exp.otherCategory || "",
        categoryLabel:
          exp.category === "other"
            ? exp.otherCategory || "Other Expense"
            : categories.find((c) => c.value === exp.category)?.label || exp.category,
        user: exp.userId?.name || "Unknown",
        userId: exp.userId?._id,
        amount: Number(exp.amount || 0),
        gst: Number(exp.gstAmount || 0),
        total: Number(exp.totalAmount || 0),
        date: exp.expenseDate ? exp.expenseDate.split("T")[0] : "",
        status: exp.approval?.status || "pending",
        description: exp.description || "",
        referenceId: exp.referenceId,
        referenceType: exp.referenceType,
        receipt: exp.receipt,
        updatedAt: exp.updatedAt,
      }));

      setExpenses(formatted);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUsers = async () => {
    if (!isAdmin) {
      setUsersList(["All Users"]);
      return;
    }

    try {
      const { data } = await API.get("/users");
      const users = ["All Users", ...data.map((user) => user.name)];
      setUsersList(users);
    } catch (err) {
      console.error("Users fetch error:", err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrentUser();
    fetchExpenses();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
  }, [isAdmin]);

  const filteredUsers = usersList.filter((user) =>
    user.toLowerCase().includes(search.toLowerCase())
  );

  const filteredExpenses =
    isAdmin && selectedUser !== "All Users"
      ? expenses.filter((exp) => exp.user === selectedUser)
      : expenses;

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.date || 0).getTime();
    const bTime = new Date(b.updatedAt || b.date || 0).getTime();
    return bTime - aTime;
  });

  const totalAmount = sortedExpenses.reduce((sum, e) => sum + e.total, 0);
  const approved = sortedExpenses.filter((e) => e.status === "approved");
  const pending = sortedExpenses.filter((e) => e.status === "pending");

  const categorySummary = categories.map((cat) => {
    const total = filteredExpenses
      .filter((e) => e.category === cat.value)
      .reduce((sum, e) => sum + e.total, 0);
    return { category: cat.label, total };
  });

  const maxCategory = Math.max(...categorySummary.map((c) => c.total), 1);

  let userSummary = [];
  if (isAdmin) {
    const grouped = {};

    for (const exp of filteredExpenses) {
      if (!grouped[exp.user]) {
        grouped[exp.user] = {
          user: exp.user,
          total: 0,
          latestUpdate: exp.updatedAt || exp.date,
        };
      }

      grouped[exp.user].total += exp.total;
      const currentLatest = new Date(grouped[exp.user].latestUpdate || 0).getTime();
      const candidate = new Date(exp.updatedAt || exp.date || 0).getTime();
      if (candidate > currentLatest) {
        grouped[exp.user].latestUpdate = exp.updatedAt || exp.date;
      }
    }

    userSummary = Object.values(grouped).sort(
      (a, b) => new Date(b.latestUpdate || 0).getTime() - new Date(a.latestUpdate || 0).getTime()
    );
  }

  const maxUser = Math.max(...userSummary.map((u) => u.total), 1);

  const totalPages = Math.max(1, Math.ceil(sortedExpenses.length / pageSize));
  const paginatedExpenses = sortedExpenses.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "category") {
      setFormData({
        ...formData,
        category: value,
        otherCategory: value === "other" ? formData.otherCategory : "",
      });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const openCreateModal = () => {
    resetForm();
    setShowLogModal(true);
  };

  const openEditModal = (expense) => {
    setEditingExpense(expense);
    setFormData({
      category: expense.category,
      otherCategory: expense.otherCategory || "",
      referenceType: expense.referenceType || "Lead",
      date: expense.date,
      total: String(expense.total),
      description: expense.description || "",
    });
    setReceiptFile(null);
    setShowLogModal(true);
  };

  const handleSubmitExpense = async () => {
    if (!currentUser) {
      alert("User not loaded yet");
      return;
    }

    if (!formData.total || !formData.date) {
      alert("Fill required fields");
      return;
    }

    if (formData.category === "other" && !formData.otherCategory.trim()) {
      alert("Please enter other expense category");
      return;
    }

    const payload = new FormData();
    payload.append("category", formData.category);
    payload.append(
      "otherCategory",
      formData.category === "other" ? formData.otherCategory.trim() : ""
    );
    payload.append("amount", String(Number(formData.total)));
    payload.append("gstAmount", "0");
    payload.append("totalAmount", String(Number(formData.total)));
    payload.append("expenseDate", formData.date);
    payload.append("description", formData.description || "");
    payload.append("referenceId", editingExpense?.referenceId || currentUser._id);
    payload.append("referenceType", formData.referenceType || "Lead");

    if (receiptFile) {
      payload.append("receipt", receiptFile);
    } else if (editingExpense?.receipt?.fileUrl) {
      payload.append("existingReceiptUrl", editingExpense.receipt.fileUrl);
    }

    try {
      if (editingExpense) {
        await API.put(`/api/expenses/${editingExpense.id}`, payload);
      } else {
        payload.append("userId", currentUser._id);
        await API.post("/api/expenses", payload);
      }

      await fetchExpenses();
      setShowLogModal(false);
      resetForm();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to save expense");
    }
  };

  const handleDelete = async (id) => {
    try {
      await API.delete(`/api/expenses/${id}`);
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to delete expense");
    }
  };

  const handleApprove = async (id) => {
    try {
      await API.put(`/api/expenses/approve/${id}`);
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to approve expense");
    }
  };

  const handleView = (expense) => {
    setViewingExpense(expense);
    setShowViewModal(true);
  };

  const getReceiptUrl = (fileUrl) => {
    if (!fileUrl) return "";
    if (/^https?:\/\//i.test(fileUrl)) return encodeURI(fileUrl);
    const base = String(API.defaults.baseURL || "").replace(/\/+$/, "");
    const normalizedPath = fileUrl.startsWith("/")
      ? fileUrl
      : `/uploads/${fileUrl}`;
    return encodeURI(`${base}${normalizedPath}`);
  };

  return (
    <div className="expense-dashboard">
      <div className="expense-cards">
        <div className="expense-card green">
          <h4>Total</h4>
          <h2>Rs. {totalAmount.toFixed(2)}</h2>
          <p>Filtered View</p>
        </div>

        <div className="expense-card blue">
          <h4>Approved</h4>
          <h2>Rs. {approved.reduce((s, e) => s + e.total, 0).toFixed(2)}</h2>
          <p>{approved.length} expenses</p>
        </div>

        <div className="expense-card orange">
          <h4>Pending</h4>
          <h2>Rs. {pending.reduce((s, e) => s + e.total, 0).toFixed(2)}</h2>
          <p>{pending.length} awaiting</p>
        </div>

        <div className="expense-card pink">
          <h4>Total Entries</h4>
          <h2>{sortedExpenses.length}</h2>
          <p>In current view</p>
        </div>
      </div>

      {isAdmin && (
        <div className="expense-middle-section">
          <div className="expense-box">
            <h3>By Category</h3>
            {categorySummary.map((item, i) => (
              <div key={i}>
                <div className="expense-progress-item">
                  <span>{item.category}</span>
                  <span>Rs. {item.total.toFixed(2)}</span>
                </div>
                <div className="expense-progress">
                  <div
                    className="expense-bar green"
                    style={{ width: `${(item.total / maxCategory) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <div className="expense-box">
            <h3>By User (Recent Updates)</h3>
            <div className="expense-by-user-scroll">
              {userSummary.map((item, i) => (
                <div key={i}>
                  <div className="expense-user-row">
                    <span>{item.user}</span>
                    <span>Rs. {item.total.toFixed(2)}</span>
                  </div>
                  <div className="expense-progress">
                    <div
                      className="expense-bar blue"
                      style={{ width: `${(item.total / maxUser) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="expense-ledger">
        <div className="expense-ledger-header">
          <h3>Expense Ledger</h3>

          <div className="expense-ledger-actions">
            {isAdmin && (
              <div className="expense-dropdown">
                <div
                  className="expense-dropdown-selected"
                  onClick={() => setShowDropdown(!showDropdown)}
                >
                  {selectedUser} &#9662;
                </div>

                {showDropdown && (
                  <div className="expense-dropdown-menu">
                    <input
                      type="text"
                      placeholder="Search user..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="expense-dropdown-list">
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
                  </div>
                )}
              </div>
            )}

            <button className="expense-ocr-btn" onClick={() => setShowModal(true)}>
              OCR
            </button>

            <button className="expense-log-btn" onClick={openCreateModal}>
              + Log Expense
            </button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Type</th>
              <th>User</th>
              <th>Amount</th>
              <th>Total</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedExpenses.map((exp) => {
              const canModifyOwnPending = exp.status === "pending" && String(exp.userId) === String(currentUser?._id);
              return (
                <tr key={exp.id}>
                  <td>{exp.categoryLabel}</td>
                  <td>{exp.referenceType || "-"}</td>
                  <td>{exp.user}</td>
                  <td>Rs. {exp.amount.toFixed(2)}</td>
                  <td>Rs. {exp.total.toFixed(2)}</td>
                  <td>{exp.date}</td>
                  <td>
                    <span className={exp.status === "approved" ? "expense-approved" : "expense-pending"}>
                      {exp.status}
                    </span>
                  </td>
                  <td>
                    <button className="expense-view" onClick={() => handleView(exp)}>
                      View
                    </button>

                    {isAdmin && exp.status === "pending" && (
                      <button className="expense-approve" onClick={() => handleApprove(exp.id)}>
                        Approve
                      </button>
                    )}

                    {isAdmin && (
                      <button className="expense-delete" onClick={() => handleDelete(exp.id)}>
                        Delete
                      </button>
                    )}

                    {!isAdmin && canModifyOwnPending && (
                      <button className="expense-view" onClick={() => openEditModal(exp)}>
                        Edit
                      </button>
                    )}

                    {!isAdmin && canModifyOwnPending && (
                      <button className="expense-delete" onClick={() => handleDelete(exp.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="expense-pagination">
          <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      </div>

      {showModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-large-modal">
              <div className="expense-modal-header">
                <h3>OCR Expense Import</h3>
                <span className="expense-close-btn" onClick={() => setShowModal(false)}>
                  x
                </span>
              </div>

              <div className="expense-upload-box">
                <input type="file" />
                <p>Drop file or click to upload</p>
                <span>Supports: JPG, PNG, PDF</span>

                <div className="expense-ai-section">
                  <button className="expense-ai-btn">+ AI OCR Processing</button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showLogModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-log-modal">
              <div className="expense-modal-header">
                <h3>{editingExpense ? "Edit Expense" : "Log Expense"}</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => {
                    setShowLogModal(false);
                    resetForm();
                  }}
                >
                  x
                </span>
              </div>

              <div className="expense-form-grid">
                <div className="expense-form-group">
                  <label>Category</label>
                  <select name="category" value={formData.category} onChange={handleChange}>
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                {formData.category === "other" && (
                  <div className="expense-form-group">
                    <label>Other Expense Category</label>
                    <input
                      type="text"
                      name="otherCategory"
                      value={formData.otherCategory}
                      onChange={handleChange}
                      placeholder="Enter custom expense category"
                    />
                  </div>
                )}

                <div className="expense-form-group">
                  <label>Date</label>
                  <input type="date" name="date" value={formData.date} onChange={handleChange} />
                </div>

                <div className="expense-form-group">
                  <label>Type Of Expense</label>
                  <select
                    name="referenceType"
                    value={formData.referenceType}
                    onChange={handleChange}
                  >
                    <option value="Lead">Lead Time</option>
                    <option value="Deal">Deal Time</option>
                  </select>
                </div>

                <div className="expense-form-group">
                  <label>Total Expense</label>
                  <input type="number" name="total" value={formData.total} onChange={handleChange} />
                </div>

                <div className="expense-form-group">
                  <label>Receipt</label>
                  <button
                    type="button"
                    className="expense-upload-receipt-btn"
                    onClick={() => document.getElementById("expenseReceiptInput")?.click()}
                  >
                    Upload Receipt
                  </button>
                  <input
                    id="expenseReceiptInput"
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  />
                  <small>{receiptFile ? receiptFile.name : "No file selected"}</small>
                </div>

                <div className="expense-form-group expense-full-width">
                  <label>Description</label>
                  <textarea name="description" value={formData.description} onChange={handleChange} />
                </div>
              </div>

              <div className="expense-modal-footer">
                <button
                  className="expense-cancel-btn"
                  onClick={() => {
                    setShowLogModal(false);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button className="expense-submit-btn" onClick={handleSubmitExpense}>
                  {editingExpense ? "Update Expense" : "Log Expense"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showViewModal &&
        viewingExpense &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-view-modal">
              <div className="expense-modal-header">
                <h3>Expense Details</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => {
                    setShowViewModal(false);
                    setViewingExpense(null);
                  }}
                >
                  x
                </span>
              </div>

              <div className="expense-view-grid">
                <div className="expense-view-item">
                  <span>Category</span>
                  <strong>{viewingExpense.categoryLabel}</strong>
                </div>
                <div className="expense-view-item">
                  <span>User</span>
                  <strong>{viewingExpense.user}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Amount</span>
                  <strong>Rs. {viewingExpense.amount.toFixed(2)}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Total</span>
                  <strong>Rs. {viewingExpense.total.toFixed(2)}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Date</span>
                  <strong>{viewingExpense.date || "-"}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Status</span>
                  <strong className={viewingExpense.status === "approved" ? "expense-approved" : "expense-pending"}>
                    {viewingExpense.status}
                  </strong>
                </div>
                <div className="expense-view-item">
                  <span>Reference Type</span>
                  <strong>{viewingExpense.referenceType || "-"}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Receipt</span>
                  {viewingExpense.receipt?.fileUrl &&
                  viewingExpense.receipt.fileUrl !== "dummy-url" ? (
                    <a
                      href={getReceiptUrl(viewingExpense.receipt.fileUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Document
                    </a>
                  ) : (
                    <strong>Not uploaded</strong>
                  )}
                </div>
                <div className="expense-view-item expense-view-full">
                  <span>Description</span>
                  <strong>{viewingExpense.description || "-"}</strong>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ExpenseDashboard;





