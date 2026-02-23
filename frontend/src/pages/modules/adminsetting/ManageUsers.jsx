import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../../api";

function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    console.log("ManageUsers mounted");
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    console.log("Calling /users API");

    try {
      const res = await API.get("/users");
      console.log("API Response:", res.data);

      setUsers(res.data);
      setError("");
    } catch (err) {
      console.error("Fetch Users Error:", err.response?.data || err.message);
      setError(
        err.response?.data?.message || "Failed to load users"
      );
    } finally {
      setLoading(false);
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

      <button onClick={() => navigate("/user-form")}>
        Add User
      </button>

      {users.length === 0 ? (
        <p>No users found</p>
      ) : (
        <table border="1" cellPadding="8">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
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
                <td>{u.is_active ? "Active" : "Inactive"}</td>
                <td>
                  <button
                    onClick={() =>
                      navigate(`/user-form/${u._id}`)
                    }
                  >
                    Edit
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