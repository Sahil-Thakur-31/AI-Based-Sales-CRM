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

    <div style={{ padding: 24 }}>

      <h2>My Profile</h2>


      {/* Avatar */}
      <img
        src={user.photoUrl || "/default-avatar.png"}
        alt="profile"
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          objectFit: "cover"
        }}
      />


      {/* Name */}
      <div>

        <label>Name</label>

        <input
          value={user.name || ""}
          disabled={!editing}
          onChange={e =>
            setUser({
              ...user,
              name: e.target.value
            })
          }
        />

      </div>


      {/* Email */}
      <div>

        <label>Email</label>

        <input
          value={user.email || ""}
          disabled={!editing}
          onChange={e =>
            setUser({
              ...user,
              email: e.target.value
            })
          }
        />

      </div>


      {/* Phone */}
      <div>

        <label>Phone</label>

        <input
          value={user.phone || ""}
          disabled={!editing}
          onChange={e =>
            setUser({
              ...user,
              phone: e.target.value
            })
          }
        />

      </div>


      {/* Role (read-only) */}
      <div>

        <label>Role</label>

        <input
          value={user.role?.name || ""}
          disabled
        />

      </div>


      {/* Joining Date (read-only) */}
      <div>

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


      {/* Buttons */}
      {!editing ? (

        <button onClick={() => setEditing(true)}>
          Edit Profile
        </button>

      ) : (

        <button onClick={updateProfile}>
          Save Changes
        </button>

      )}

    </div>

  );

}
