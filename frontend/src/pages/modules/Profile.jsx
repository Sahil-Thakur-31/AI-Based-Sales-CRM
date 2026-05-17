import { useEffect, useRef, useState } from "react";
import API from "../../api";
import PhoneInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";
import FormErrorSlot from "../../components/FormErrorSlot";
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

function splitNameParts(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: words[0] || "",
    lastName: words.slice(1).join(" ")
  };
}

function composeFullName(firstName, lastName) {
  return [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function withSplitName(user) {
  const source = user || {};
  const { firstName, lastName } = splitNameParts(source.name);
  return {
    ...source,
    firstName,
    lastName
  };
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

export default function Profile() {
  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [saveError, setSaveError] = useState("");

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await API.get("/users/me");
      setUser(withSplitName(res.data));
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
      setSaveError("");
      const firstName = String(user.firstName || "").trim();
      const lastName = String(user.lastName || "").trim();
      const namePattern = /^[A-Za-z][A-Za-z\s'-]*$/;

      if (!firstName) {
        setSaveError("First name is required");
        return;
      }

      if (!lastName) {
        setSaveError("Last name is required");
        return;
      }

      if (!namePattern.test(firstName) || !namePattern.test(lastName)) {
        setSaveError("First and last name can contain only letters, spaces, apostrophe, and hyphen");
        return;
      }

      const formData = new FormData();
      const fullName = composeFullName(firstName, lastName);

      formData.append("name", fullName);
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

      setUser(withSplitName(res.data));
      setEditing(false);
      setSelectedFile(null);
      setSaveError("");
    } catch (err) {
      console.error(err);
      setSaveError(err?.response?.data?.message || "Failed to update profile");
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    setSelectedFile(null);
    setSaveError("");
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
              <button className="profile-btn profile-btn-primary" onClick={() => {
                setSaveError("");
                setEditing(true);
              }}>
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

          <FormErrorSlot message={saveError} className="form-error-slot-global profile-form-error-slot" />

          <div className="profile-grid">
            <div className="profile-field">
              <label htmlFor="user-first-name">First Name</label>
              <input
                id="user-first-name"
                name="firstName"
                autoComplete="given-name"
                value={user.firstName || ""}
                disabled={!editing}
                onChange={(e) => {
                  const nextFirstName = e.target.value;
                  setUser((prev) => ({
                    ...prev,
                    firstName: nextFirstName,
                    name: composeFullName(nextFirstName, prev?.lastName)
                  }));
                }}
              />
            </div>

            <div className="profile-field">
              <label htmlFor="user-last-name">Last Name</label>
              <input
                id="user-last-name"
                name="lastName"
                autoComplete="family-name"
                value={user.lastName || ""}
                disabled={!editing}
                onChange={(e) => {
                  const nextLastName = e.target.value;
                  setUser((prev) => ({
                    ...prev,
                    lastName: nextLastName,
                    name: composeFullName(prev?.firstName, nextLastName)
                  }));
                }}
              />
            </div>

            <div className="profile-field">
              <label htmlFor="user-email">Email</label>
              <input
                id="user-email"
                name="email"
                type="email"
                autoComplete="email"
                value={user.email || ""}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
              />
            </div>

            <div className="profile-field">
              <label htmlFor="user-phone">Phone</label>
              <PhoneInput
                id="user-phone"
                name="phone"
                autoComplete="tel"
                international
                defaultCountry="IN"
                flags={flags}
                value={user.phone || ""}
                disabled={!editing}
                onChange={(val) => setUser({ ...user, phone: val })}
                numberInputProps={{ id: 'user-phone' }}
              />
            </div>

            <div className="profile-field">
              <label htmlFor="user-gender">Gender</label>
              <select
                id="user-gender"
                name="gender"
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
              <label htmlFor="user-dob">Date of Birth</label>
              <input
                id="user-dob"
                name="dateOfBirth"
                type="date"
                autoComplete="bday"
                value={formatDateForInput(user.dateOfBirth)}
                disabled={!editing}
                onChange={(e) => setUser({ ...user, dateOfBirth: e.target.value })}
              />
            </div>

            <div className="profile-field profile-field-full">
              <label htmlFor="user-address">Address</label>
              <textarea
                id="user-address"
                name="address"
                autoComplete="street-address"
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
