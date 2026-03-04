import { useEffect, useRef, useState } from "react";
import API from "../../api";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import "./styles/profile.css";

function formatDateForInput(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().split("T")[0];
}

function formatDateForDisplay(value) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getInitials(name) {
  if (!name) return "U";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function getProfileCompletion(user) {
  if (!user) return 0;

  const keys = ["name", "email", "phone", "gender", "dateOfBirth", "address", "photoUrl"];
  const filled = keys.filter((key) => {
    const value = user[key];
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }).length;

  return Math.round((filled / keys.length) * 100);
}

function getMissingProfileFields(user) {
  if (!user) return [];

  const fields = [
    { key: "phone", label: "Phone" },
    { key: "gender", label: "Gender" },
    { key: "dateOfBirth", label: "Date of birth" },
    { key: "address", label: "Address" },
    { key: "photoUrl", label: "Profile photo" }
  ];

  return fields
    .filter(({ key }) => {
      const value = user[key];
      return typeof value === "string" ? value.trim().length === 0 : !value;
    })
    .map(({ label }) => label);
}

function getWorkTenure(joiningDate) {
  if (!joiningDate) return "Not available";

  const start = new Date(joiningDate);
  if (Number.isNaN(start.getTime())) return "Not available";

  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());

  if (now.getDate() < start.getDate()) {
    months -= 1;
  }

  if (months < 1) return "Less than 1 month";

  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  if (years === 0) return `${remMonths} month${remMonths === 1 ? "" : "s"}`;
  if (remMonths === 0) return `${years} year${years === 1 ? "" : "s"}`;

  return `${years}y ${remMonths}m`;
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await API.get("/users/me");
      setUser(res.data);
    } finally {
      setLoading(false);
    }
  };

  const resolvePhotoUrl = (photoUrl) => {
    if (!photoUrl) return null;
    if (photoUrl.startsWith("blob:")) return photoUrl;
    if (photoUrl.startsWith("http")) return photoUrl;

    return `${API.defaults.baseURL.replace(/\/$/, "")}${photoUrl}`;
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setSelectedFile(file);

    const previewUrl = URL.createObjectURL(file);
    setUser({
      ...user,
      photoUrl: previewUrl
    });
  };

  const updateProfile = async () => {
    if (!user) return;

    try {
      const formData = new FormData();

      formData.append("name", user.name || "");
      formData.append("email", user.email || "");
      formData.append("phone", user.phone || "");
      formData.append("address", user.address || "");
      formData.append("gender", user.gender || "");
      formData.append("dateOfBirth", user.dateOfBirth || "");

      if (selectedFile) {
        formData.append("photo", selectedFile);
      }

      const res = await API.put("/users/me", formData, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });

      setUser(res.data);
      setEditing(false);
      setSelectedFile(null);
    } catch (err) {
      console.error(err);
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    setSelectedFile(null);
    fetchProfile();
  };

  if (loading) {
    return <div className="profile-loading">Loading...</div>;
  }

  if (!user) {
    return <div className="profile-loading">Unable to load profile.</div>;
  }

  const profileCompletion = getProfileCompletion(user);
  const missingFields = getMissingProfileFields(user);
  const workTenure = getWorkTenure(user.joiningDate);

  return (
    <div className="profile-page">
      <div className="profile-shell">
        <aside className="profile-hero-card">
          <div className="profile-hero-banner" />

          <div
            className={`profile-avatar-large ${editing ? "editable" : ""}`}
            onClick={() => editing && fileInputRef.current?.click()}
          >
            {user.photoUrl ? (
              <img src={resolvePhotoUrl(user.photoUrl)} alt="avatar" />
            ) : (
              getInitials(user.name)
            )}
          </div>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />

          <p className="profile-hero-caption">Profile Photo</p>
          <div className="profile-role-pill">{user.role?.name || "User"}</div>

          <div className="profile-side-panel">
            <div className="profile-side-panel-head">
              <span>Profile Completion</span>
              <strong>{profileCompletion}%</strong>
            </div>

            <div className="profile-completion-track">
              <span style={{ width: `${profileCompletion}%` }} />
            </div>

            <p className="profile-hero-note">
              {missingFields.length
                ? `Missing: ${missingFields.slice(0, 3).join(", ")}${missingFields.length > 3 ? "..." : ""}`
                : "All key profile details are completed."}
            </p>
          </div>

          <div className="profile-side-panel">
            <div className="profile-side-row">
              <span>Account Status</span>
              <strong className={user.is_active ? "active-text" : "inactive-text"}>
                {user.is_active ? "Active" : "Inactive"}
              </strong>
            </div>

            <div className="profile-side-row">
              <span>Profile ID</span>
              <strong>{user?._id ? user._id.slice(-8).toUpperCase() : "N/A"}</strong>
            </div>

            <div className="profile-side-row">
              <span>Joined On</span>
              <strong>{formatDateForDisplay(user.createdAt)}</strong>
            </div>
          </div>

          {editing && (
            <p className="profile-avatar-hint">Click avatar to change photo</p>
          )}
        </aside>

        <section className="profile-form-card">
          <div className="profile-form-header">
            <div>
              <p className="profile-kicker">Profile Settings</p>
              <h2>Personal Information</h2>
            </div>

            {!editing ? (
              <button className="profile-btn profile-btn-primary" onClick={() => setEditing(true)}>
                Edit Profile
              </button>
            ) : (
              <div className="profile-actions">
                <button className="profile-btn profile-btn-secondary" onClick={cancelEditing}>
                  Cancel
                </button>

                <button className="profile-btn profile-btn-primary" onClick={updateProfile}>
                  Save Changes
                </button>
              </div>
            )}
          </div>

          <div className="profile-grid">
            <div className="profile-field">
              <label>Full Name</label>
              <input
                value={user.name || ""}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, name: e.target.value })}
              />
            </div>

            <div className="profile-field">
              <label>Email</label>
              <input
                type="email"
                value={user.email || ""}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
              />
            </div>

            <div className="profile-field">
              <label>Phone</label>
              <PhoneInput
                international
                defaultCountry="IN"
                value={user.phone || ""}
                disabled={!editing}
                onChange={(val) => setUser({ ...user, phone: val })}
              />
            </div>

            <div className="profile-field">
              <label>Gender</label>
              <select
                value={user.gender || ""}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, gender: e.target.value })}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Others">Others</option>
              </select>
            </div>

            <div className="profile-field">
              <label>Date of Birth</label>
              <input
                type="date"
                value={formatDateForInput(user.dateOfBirth)}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, dateOfBirth: e.target.value })}
              />
            </div>

            <div className="profile-field">
              <label>Work Tenure</label>
              <div className="profile-insight-card">
                <strong>{workTenure}</strong>
                <span>Based on joining date</span>
              </div>
            </div>

            <div className="profile-field profile-field-full">
              <label>Address</label>
              <textarea
                value={user.address || ""}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, address: e.target.value })}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
