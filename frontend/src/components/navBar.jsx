import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect, useRef } from "react";
import { routeConfig } from "../config/routeConfig";
import API from "../api";
import Logout from "./Logout";
import "./navBar.css";

function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  /* timers */
  const profileMenuTimer = useRef(null);
  const adminMenuTimer = useRef(null);
  const notificationTimer = useRef(null);


  /* Fetch user */
  useEffect(() => {

    fetchUser();

  }, []);


  const fetchUser = async () => {

    try {

      const res = await API.get("/users/me");

      setUser(res.data);

    }
    catch (err) {

      console.error("Navbar user fetch failed:", err);

    }

  };


  /* Resolve photo URL safely */
  const resolvePhotoUrl = (photoUrl) => {

    if (!photoUrl) return null;

    if (photoUrl.startsWith("blob:"))
      return photoUrl;

    if (photoUrl.startsWith("http"))
      return photoUrl;

    return `${API.defaults.baseURL.replace(/\/$/, "")}${photoUrl}`;

  };


  /* Fetch notifications */
  const fetchNotifications = async () => {

    try {

      setLoadingNotifications(true);

      const res = await API.get("/api/notifications");

      setNotifications(res.data);

    }
    catch (err) {

      console.error(err);

    }
    finally {

      setLoadingNotifications(false);

    }

  };


  useEffect(() => {

    if (showNotifications)
      fetchNotifications();

  }, [showNotifications]);


  /* Module title */
  const moduleName = useMemo(() => {

    const route = routeConfig.find(
      r => location.pathname.startsWith(r.path)
    );

    return route ? route.title : "Dashboard";

  }, [location.pathname]);


  /* Initials fallback */
  const getInitials = (name) => {

    if (!name) return "?";

    const parts = name.trim().split(" ");

    if (parts.length === 1)
      return parts[0][0].toUpperCase();

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();

  };


  /* PROFILE hover handlers */
  const handleProfileEnter = () => {

    if (profileMenuTimer.current)
      clearTimeout(profileMenuTimer.current);

    setShowProfileMenu(true);

  };

  const handleProfileLeave = () => {

    profileMenuTimer.current = setTimeout(() => {

      setShowProfileMenu(false);

    }, 700);

  };


  /* ADMIN hover handlers */
  const handleAdminEnter = () => {

    if (adminMenuTimer.current)
      clearTimeout(adminMenuTimer.current);

    setShowAdminMenu(true);

  };

  const handleAdminLeave = () => {

    adminMenuTimer.current = setTimeout(() => {

      setShowAdminMenu(false);

    }, 700);

  };


  /* NOTIFICATION hover handlers */
  const handleNotificationEnter = () => {

    if (notificationTimer.current)
      clearTimeout(notificationTimer.current);

    setShowNotifications(true);

  };

  const handleNotificationLeave = () => {

    notificationTimer.current = setTimeout(() => {

      setShowNotifications(false);

    }, 700);

  };


  if (!user)
    return null;


  return (

    <div className="navbar">


      {/* LEFT */}
      <div className="navbar-left">

        <h2 className="module-title">
          {moduleName}
        </h2>

      </div>


      {/* RIGHT */}
      <div className="navbar-right">


        {/* ADMIN MENU */}
        {user.role?.name === "Admin" && (

          <div
            className="admin-menu-container"
            onMouseEnter={handleAdminEnter}
            onMouseLeave={handleAdminLeave}
          >

            <button className="nav-icon-btn">
              ⚙️
            </button>

            <div className={`admin-dropdown ${showAdminMenu ? "visible" : "hidden"}`}>

              <div onClick={() => navigate("/products")}>
                Products
              </div>

              <div onClick={() => navigate("/roles")}>
                Roles
              </div>

              <div onClick={() => navigate("/manageusers")}>
                Users
              </div>

              <div onClick={() => navigate("/industry")}>
                Industry
              </div>

              <div onClick={() => navigate("/sources")}>
                Sources
              </div>

            </div>

          </div>

        )}


        {/* NOTIFICATIONS */}
        <div
          className="notification-container"
          onMouseEnter={handleNotificationEnter}
          onMouseLeave={handleNotificationLeave}
        >

          <button className="nav-icon-btn">
            🔔
          </button>

          <div className={`notification-dropdown ${showNotifications ? "visible" : "hidden"}`}>

            <div className="notification-header">
              Notifications
            </div>

            {loadingNotifications ? (

              <div className="notification-empty">
                Loading...
              </div>

            ) : notifications.length === 0 ? (

              <div className="notification-empty">
                No notifications
              </div>

            ) : (

              notifications.map(n => (

                <div key={n._id} className="notification-item">

                  <div className="notification-title">
                    {n.title}
                  </div>

                  <div className="notification-message">
                    {n.message}
                  </div>

                  <div className="notification-time">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>

                </div>

              ))

            )}

          </div>

        </div>


        {/* PROFILE MENU */}
        <div
          className="profile-menu-container"
          onMouseEnter={handleProfileEnter}
          onMouseLeave={handleProfileLeave}
        >

          <div className="profile-section">

            <div className="profile-info">

              <span className="profile-name">
                {user.name}
              </span>

              <span className="profile-role">
                {user.role?.name}
              </span>

            </div>

            {user.photoUrl ? (

              <img
                src={resolvePhotoUrl(user.photoUrl)}
                className="profile-avatar"
                alt="avatar"
              />

            ) : (

              <div className="profile-avatar">
                {getInitials(user.name)}
              </div>

            )}

          </div>


          <div className={`profile-dropdown ${showProfileMenu ? "visible" : "hidden"}`}>

            <div onClick={() => navigate("/profile")}>
              My Profile
            </div>

            <Logout className="profile-dropdown-item" />

          </div>

        </div>


      </div>

    </div>

  );

}

export default Navbar;