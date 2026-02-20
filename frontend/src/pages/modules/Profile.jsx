import { useEffect, useState, useRef } from "react";
import API from "../../api";
import "./styles/profile.css";

export default function Profile() {

  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef();


  useEffect(() => {
    fetchProfile();
  }, []);


  const fetchProfile = async () => {

    try {

      const res = await API.get("/users/me");

      setUser(res.data);

    }
    finally {
      setLoading(false);
    }

  };

  const resolvePhotoUrl = (photoUrl) => {

    if (!photoUrl) return null;
    if (photoUrl.startsWith("blob:"))
      return photoUrl;
    if (photoUrl.startsWith("http"))
      return photoUrl;
    return `${API.defaults.baseURL.replace(/\/$/, "")}${photoUrl}`;
  };

  /* IMAGE SELECT */
  const handleImageSelect = (e) => {

    const file = e.target.files[0];

    if (!file) return;

    setSelectedFile(file);

    // Preview immediately
    const previewUrl = URL.createObjectURL(file);

    setUser({
      ...user,
      photoUrl: previewUrl
    });

  };


  /* UPDATE PROFILE */
  const updateProfile = async () => {

    try {

      const formData = new FormData();

      formData.append("email", user.email);
      formData.append("phone", user.phone);
      formData.append("address", user.address);

      if (selectedFile)
        formData.append("photo", selectedFile);

      const res = await API.put(
        "/users/me",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        }
      );

      setUser(res.data);

      setEditing(false);

      setSelectedFile(null);

    }
    catch (err) {

      console.error(err);

    }

  };


  if (loading)
    return <div className="profile-loading">Loading...</div>;


  return (

    <div className="profile-container">

      <div className="profile-card">


        {/* LEFT SIDE */}

        <div className="profile-left">


          <div
            className={`profile-avatar-large ${editing ? "editable" : ""}`}
            onClick={() =>
              editing && fileInputRef.current.click()
            }
          >

            {user.photoUrl
              ? <img src={resolvePhotoUrl(user.photoUrl)} alt="avatar"/>
              : user.name?.charAt(0).toUpperCase()
            }

          </div>


          {/* hidden input */}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />


          <div className="profile-name-large">
            {user.name}
          </div>

          <div className="profile-role-large">
            {user.role?.name}
          </div>


          <div className="profile-meta">

            <div className="profile-meta-row">
              <span>DOB</span>
              <span>
                {user.dateOfBirth
                  ? new Date(user.dateOfBirth).toLocaleDateString()
                  : "—"}
              </span>
            </div>

            <div className="profile-meta-row">
              <span>Gender</span>
              <span>{user.gender || "—"}</span>
            </div>

            <div className="profile-meta-row">
              <span>Joined</span>
              <span>
                {new Date(user.joiningDate).toLocaleDateString()}
              </span>
            </div>

          </div>

        </div>


        {/* RIGHT SIDE unchanged */}

        <div className="profile-right">

          <div className="profile-section-title">
            Contact Information
          </div>

          <div className="profile-grid">

            <div className="profile-field">

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


            <div className="profile-field">

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


            <div className="profile-field full-width">

              <label>Address</label>

              <textarea
                value={user.address || ""}
                disabled={!editing}
                onChange={e =>
                  setUser({
                    ...user,
                    address: e.target.value
                  })
                }
              />

            </div>

          </div>


          <div className="profile-actions">

            {!editing ? (

              <button
                className="btn-primary"
                onClick={() => setEditing(true)}
              >
                Edit Profile
              </button>

            ) : (

              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setEditing(false);
                    fetchProfile();
                  }}
                >
                  Cancel
                </button>

                <button
                  className="btn-primary"
                  onClick={updateProfile}
                >
                  Save Changes
                </button>
              </>

            )}

          </div>

        </div>

      </div>

    </div>

  );

}