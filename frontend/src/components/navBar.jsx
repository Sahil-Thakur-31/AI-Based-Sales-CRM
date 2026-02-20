import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { routeConfig } from "../config/routeConfig";
import "./navBar.css";

function Navbar({ user }) {

  const location = useLocation();
  const navigate = useNavigate();

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  const token = localStorage.getItem("token");


  const handleLogout = () => {

    localStorage.removeItem("token");
    localStorage.removeItem("Name");
    localStorage.removeItem("RoleName");

    navigate("/login", { replace: true });

  };


  const fetchNotifications = async () => {

    try {

      setLoadingNotifications(true);

      const res = await fetch(
        "http://localhost:8080/api/notifications",
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();

      setNotifications(data);

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


  const moduleName = useMemo(() => {

    const currentRoute = routeConfig.find(
      route => location.pathname.startsWith(route.path)
    );

    return currentRoute ? currentRoute.title : "Dashboard";

  }, [location.pathname]);


  const getInitials = (name) => {

    if (!name) return "?";

    const parts = name.split(" ");

    if (parts.length === 1)
      return parts[0][0].toUpperCase();

    return (
      parts[0][0] +
      parts[parts.length - 1][0]
    ).toUpperCase();

  };


  return (

    <div className="navbar">

      <div className="navbar-left">
        <h2 className="module-title">{moduleName}</h2>
      </div>


      <div className="navbar-right">


        {/* Admin menu */}
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

          <button className="nav-icon-btn">🔔</button>

          {showNotifications && (

            <div className="notification-dropdown">

              <div className="notification-header">
                Notifications
              </div>

              {loadingNotifications
                ? <div className="notification-empty">Loading...</div>
                : notifications.length === 0
                  ? <div className="notification-empty">No notifications</div>
                  : notifications.map(n => (

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
              }

            </div>

          )}

        </div>


        {/* Profile menu */}
        <div
          className="profile-menu-container"
          onMouseEnter={() => setShowProfileMenu(true)}
          onMouseLeave={() => setShowProfileMenu(false)}
        >

          <div className="profile-section">

            <div className="profile-info">

              <span className="profile-name" title={user?.name}>
                {user?.name || "Unknown User"}
              </span>

              <span className="profile-role">
                {user?.role}
              </span>

            </div>

            {user?.avatar
              ? <img src={user.avatar} className="profile-avatar"/>
              : <div className="profile-avatar">
                  {getInitials(user?.name)}
                </div>
            }

          </div>


          {showProfileMenu && (

            <div className="profile-dropdown">

              <div onClick={() => navigate("/profile")}>
                My Profile
              </div>

              <div onClick={handleLogout}>
                Logout
              </div>

            </div>

          )}

        </div>


      </div>

    </div>

  );

}

export default Navbar;