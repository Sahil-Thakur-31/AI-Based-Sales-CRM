import { useEffect, useState } from "react";
import API from '../../api'
import "./styles/profile.css"

export default function Profile() {

  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    fetchProfile();
  }, []);


  const fetchProfile = async () => {

    try {

      const res = await API.get("/users/me");

      setUser(res.data);

    }
    catch (error) {

      console.error(
        "Profile fetch failed:",
        error.response?.data || error.message
      );

    }
    finally {

      setLoading(false);

    }

  };


  const updateProfile = async () => {

    try {

      const res = await API.put(
        "/api/users/me",
        {
          name: user.name,
          email: user.email,
          phone: user.phone,
          photoUrl: user.photoUrl
        }
      );

      setUser(res.data);

      setEditing(false);

    }
    catch (error) {

      console.error(
        "Profile update failed:",
        error.response?.data || error.message
      );

    }

  };


  if (loading)
    return <div style={{ padding: 24 }}>Loading profile...</div>;

  if (!user)
    return <div style={{ padding: 24 }}>Profile not found</div>;

return (
  <div className="profile-page">
    <div className="profile-card">
      {/* Header with avatar, name, and role */}
      <div className="profile-header">
        <img
          src={user.photoUrl || "/default-avatar.png"}
          alt="profile"
          className="profile-avatar"
        />
        <div className="profile-name">{user.name}</div>
        <div className="profile-role">{user.role?.name}</div>
      </div>

      {/* Editable form fields */}
      <div className="profile-form">
        <div className="profile-field">
          <label>Name</label>
          <input
            value={user.name || ""}
            disabled={!editing}
            onChange={(e) =>
              setUser({ ...user, name: e.target.value })
            }
          />
        </div>

        <div className="profile-field">
          <label>Email</label>
          <input
            value={user.email || ""}
            disabled={!editing}
            onChange={(e) =>
              setUser({ ...user, email: e.target.value })
            }
          />
        </div>

        <div className="profile-field">
          <label>Phone</label>
          <input
            value={user.phone || ""}
            disabled={!editing}
            onChange={(e) =>
              setUser({ ...user, phone: e.target.value })
            }
          />
        </div>

        <div className="profile-field">
          <label>Joining Date</label>
          <input
            value={
              user.joiningDate
                ? new Date(user.joiningDate).toLocaleDateString()
                : ""
            }
            disabled
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="profile-actions">
        {!editing ? (
          <button
            className="profile-button"
            onClick={() => setEditing(true)}
          >
            Edit Profile
          </button>
        ) : (
          <button
            className="profile-button"
            onClick={updateProfile}
          >
            Save Changes
          </button>
        )}
      </div>
    </div>
  </div>
);

}
