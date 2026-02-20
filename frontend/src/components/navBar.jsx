import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { routeConfig } from "../config/routeConfig";
import "./navBar.css";

function Navbar({ user }) {

  const location = useLocation();
  const navigate = useNavigate();

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);


  const token = localStorage.getItem("token");


  // Fetch notifications from backend
  const fetchNotifications = async () => {

    try {

      setLoadingNotifications(true);

      const response = await fetch(
        "http://localhost:5000/api/notifications",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          }
        }
      );

      if (!response.ok)
        throw new Error("Failed to fetch notifications");

      const data = await response.json();

      setNotifications(data);

    }
    catch (error) {

      console.error("Notification fetch error:", error);

    }
    finally {

      setLoadingNotifications(false);

    }

  };


  // Fetch only when dropdown opens
  useEffect(() => {

    if (showNotifications)
      fetchNotifications();

  }, [showNotifications]);


  const moduleName = useMemo(() => {

    const currentRoute = routeConfig.find(
      route => location.pathname.startsWith(route.path)
    );

    return currentRoute ? currentRoute.title : "Dashboard";

  }, [location.pathname]);


  const getInitials = (name) => {

    if (!name) return "?";

    const parts = name.trim().split(" ");

    if (parts.length === 1)
      return parts[0][0].toUpperCase();

    return parts[0][0].toUpperCase() +
           parts[parts.length - 1][0].toUpperCase();
  };


  return (
    <div className="navbar">

      <div className="navbar-left">
        <h2 className="module-title">{moduleName}</h2>
      </div>


      <div className="navbar-right">


        {/* Admin menu unchanged */}
        {user?.role === "Admin" && (
          <div
            className="admin-menu-container"
            onMouseEnter={() => setShowAdminMenu(true)}
            onMouseLeave={() => setShowAdminMenu(false)}
          >
            <button className="nav-icon-btn">⚙️</button>

            {showAdminMenu && (
              <div className="admin-dropdown">
                <div onClick={() => navigate("/products")}>Products</div>
                <div onClick={() => navigate("/roles")}>Roles</div>
                <div onClick={() => navigate("/manageusers")}>Users</div>
                <div onClick={() => navigate("/industry")}>Industry</div>
                <div onClick={() => navigate("/sources")}>Sources</div>
              </div>
            )}
          </div>
        )}


        {/* Notifications */}
        <div
          className="notification-container"
          onMouseEnter={() => setShowNotifications(true)}
          onMouseLeave={() => setShowNotifications(false)}
        >

          <button className="nav-icon-btn">
            🔔
          </button>


          {showNotifications && (
            <div className="notification-dropdown">

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

                notifications.map(notification => (

                  <div
                    key={notification._id}
                    className="notification-item"
                  >

                    <div className="notification-title">
                      {notification.title}
                    </div>

                    <div className="notification-message">
                      {notification.message}
                    </div>

                    <div className="notification-time">
                      {new Date(notification.createdAt)
                        .toLocaleString()}
                    </div>

                  </div>

                ))

              )}

            </div>
          )}

        </div>


        {/* Profile unchanged */}
        <div
          className="profile-section"
          onClick={() => navigate("/profile")}
        >

          <div className="profile-info">

            <span className="profile-name">
              {user?.name || "Unknown User"}
            </span>

            <span className="profile-role">
              {user?.role}
            </span>

          </div>

          {user?.avatar
            ? <img src={user.avatar} className="profile-avatar" />
            : <div className="profile-avatar">
                {getInitials(user?.name)}
              </div>
          }

        </div>

      </div>

    </div>
  );
}

export default Navbar;
