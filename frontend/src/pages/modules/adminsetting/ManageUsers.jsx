import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../../api";
import "./ManageUsers.css";

function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await API.get("/users");
      setUsers(res.data);
      setError("");
    } catch (err) {
      console.error("Fetch Users Error:", err.response?.data || err.message);
      setError(err.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Soft Delete Function
  const handleDelete = async (id) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this user?");
    if (!confirmDelete) return;

    try {
      await API.put(`/users/delete/${id}`); // Make sure backend route matches
      alert("User deleted successfully");

      // Remove deleted user from UI instantly
      setUsers(users.filter((u) => u._id !== id));
    } catch (err) {
      console.error("Delete Error:", err.response?.data || err.message);
      alert("Delete failed");
    }
  };

  if (loading) {
    return <div className="container">Loading users...</div>;
  }

  if (error) {
    return <div className="container">Error: {error}</div>;
  }

  return (
    <div className="container">
  <h2>User Management</h2>

  <button
    className="add-btn"
    onClick={() => navigate("/user-form")}
  >
    Add User
  </button>

  {users.length === 0 ? (
    <p>No users found</p>
  ) : (
    <table className="user-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody>
        {users.map((u, i) => (
          <tr key={u._id}>
            <td>{i + 1}</td>
            <td>{u.name}</td>
            <td>{u.email}</td>
            <td>{u.role?.name || "—"}</td>
            <td>
              <button
                className="edit-btn"
                onClick={() => navigate(`/user-form/${u._id}`)}
              >
                Edit
              </button>

              <button
                className="delete-btn"
                onClick={() => handleDelete(u._id)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>
  );
}

export default ManageUsers;