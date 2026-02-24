import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../../api";
import "./UserForm.css";

function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "",
    joinDate: ""
  });

  // -----------------------------------
  // Load roles + user if editing
  // -----------------------------------
  useEffect(() => {
    fetchRoles();
    if (id) loadUser();
  }, [id]);

  // -----------------------------------
  // Fetch roles
  // -----------------------------------
  const fetchRoles = async () => {
    try {
      const res = await API.get("/roles");
      setRoles(res.data);
    } catch (err) {
      console.error("Failed to load roles", err);
      setError("Failed to load roles");
    }
  };

  // -----------------------------------
  // Load existing user
  // -----------------------------------
  const loadUser = async () => {
    try {
      const res = await API.get(`/users/${id}`);

      setForm({
        name: res.data.name || "",
        email: res.data.email || "",
        password: "",
        role: res.data.role?._id || res.data.role || "",
        joinDate: res.data.joiningDate
          ? res.data.joiningDate.substring(0, 10)
          : ""
      });
    } catch (err) {
      console.error("User load failed", err);
      setError("Failed to load user data");
    }
  };

  // -----------------------------------
  // Input change
  // -----------------------------------
  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value
    });
  };

  // -----------------------------------
  // Submit
  // -----------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name || !form.email || !form.role) {
      alert("Please fill all required fields");
      return;
    }

    try {
      setLoading(true);
      setError("");

      if (id) {
        // ✅ EDIT USER
        await API.put(`/users/${id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
          joinDate: form.joinDate
        });

        alert("User updated successfully");
      } else {
        // ✅ CREATE USER (REGISTER)
        if (!form.password) {
          alert("Password required");
          return;
        }

        await API.post("/auth/register", {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          joinDate: form.joinDate
        });

        alert("User created successfully");
      }

      navigate("/manageusers");

    } catch (err) {
      console.error("Save failed", err);
      setError(
        err.response?.data?.msg || "Failed to save user"
      );
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------------
  // UI
  // -----------------------------------
  return (
    <div className="container">
      <h2>{id ? "Edit User" : "Add User"}</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <form onSubmit={handleSubmit}>

        <div>
          <label>Name *</label>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label>Email *</label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
          />
        </div>

        {!id && (
          <div>
            <label>Password *</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>
        )}

        <div>
          <label>Joining Date</label>
          <input
            type="date"
            name="joinDate"
            value={form.joinDate}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Role *</label>
          <select
            name="role"
            value={form.role}
            onChange={handleChange}
            required
          >
            <option value="">Select Role</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading}>
          {loading
            ? "Saving..."
            : id
            ? "Update User"
            : "Create User"}
        </button>

      </form>
    </div>
  );
}

export default UserForm;