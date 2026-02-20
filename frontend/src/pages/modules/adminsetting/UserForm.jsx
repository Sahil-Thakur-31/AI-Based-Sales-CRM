import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../../api";

function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: ""
  });

  // Load roles + user (if edit)
  useEffect(() => {
    fetchRoles();

    if (id) loadUser();
  }, [id]);

  // -----------------------------
  // Fetch roles
  // -----------------------------
  const fetchRoles = async () => {
    try {
      const res = await API.get("/roles");
      setRoles(res.data);
    } catch (err) {
      console.error("Role fetch failed", err);
    }
  };

  // -----------------------------
  // Load existing user
  // -----------------------------
  const loadUser = async () => {
    try {
      const res = await API.get(`/users/${id}`);

      setForm({
        name: res.data.name,
        email: res.data.email,
        password: "",
        role: res.data.role?._id || res.data.role
      });

    } catch (err) {
      console.error("User load failed", err);
    }
  };

  // -----------------------------
  // Input change
  // -----------------------------
  const handleChange = e =>
    setForm({ ...form, [e.target.name]: e.target.value });

  // -----------------------------
  // Submit
  // -----------------------------
  const handleSubmit = async e => {
    e.preventDefault();

    if (!form.name || !form.email || !form.role) {
      alert("All required fields missing");
      return;
    }

    try {
      setLoading(true);

      if (id) {
        await API.put(`/users/${id}`, form);
      } else {
        if (!form.password) {
          alert("Password required");
          return;
        }

        await API.post("/users", form);
      }

      navigate("/manageusers");

    } catch (err) {
      console.error("Save failed", err);
      alert("Failed to save user");
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="container">

      <h2>{id ? "Edit User" : "Add User"}</h2>

      <form onSubmit={handleSubmit}>

        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          placeholder="Name"
          required
        />

        <input
          type="email"
          name="email"
          value={form.email}
          onChange={handleChange}
          placeholder="Email"
          required
        />

        {!id && (
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Password"
            required
          />
        )}

        <label>Role</label>

        <select
          name="role"
          value={form.role}
          onChange={handleChange}
          required
        >
          <option value="">Select Role</option>

          {roles.map(role => (
            <option key={role._id} value={role._id}>
              {role.name}
            </option>
          ))}
        </select>

        <button disabled={loading}>
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
