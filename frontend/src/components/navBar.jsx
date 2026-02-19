import { useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import "./navBar.css";

function Navbar({ user }) {

  const location = useLocation();
  const navigate = useNavigate();

  // Route → Module name mapping
  const moduleName = useMemo(() => {

    const path = location.pathname.toLowerCase();

    if (path.includes("adminhome")) return "Admin Dashboard";
    if (path.includes("managerhome")) return "Manager Dashboard";
    if (path.includes("manageusers")) return "Manage Users";
    if (path.includes("user-form")) return "User Form";

    return "Dashboard";

  }, [location.pathname]);


  // Generate initials from full name
  const getInitials = (name) => {

    if (!name) return "?";

    const parts = name.trim().split(" ");

    if (parts.length === 1)
      return parts[0][0].toUpperCase();

    return (
      parts[0][0].toUpperCase() +
      parts[parts.length - 1][0].toUpperCase()
    );

  };


  const handleProfileClick = () => navigate("/profile");

  const handleAdminConfig = () => navigate("/admin-config");

  const handleNotifications = () => navigate("/notifications");


  return (

    <div className="navbar">

      <div className="navbar-left">
        <h2 className="module-title">{moduleName}</h2>
      </div>


      <div className="navbar-right">

        {user?.role === "Admin" && (
          <button className="nav-icon-btn" onClick={handleAdminConfig}>
            ⚙️
          </button>
        )}
        
        
        <button className="nav-icon-btn" onClick={handleNotifications}>
          🔔
        </button>


        <div className="profile-section" onClick={handleProfileClick}>

          <div className="profile-info">

            <span className="profile-name">
              {user?.name || "Unknown User"}
            </span>

            <span className="profile-role">
              {user?.role || ""}
            </span>

          </div>


          {/* Avatar logic */}
          {user?.avatar ? (

            <img
              src={user.avatar}
              alt="avatar"
              className="profile-avatar"
            />

          ) : (

            <div className="profile-avatar">
              {getInitials(user?.name)}
            </div>

          )}

        </div>

      </div>

    </div>

  );

}

export default Navbar;
