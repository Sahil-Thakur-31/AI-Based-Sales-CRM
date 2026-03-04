import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect, useRef } from "react";
import { routeConfig } from "../config/routeConfig";
import API from "../api";
import Logout from "./Logout";
import "./navBar.css";

const SEEN_NOTIFICATIONS_KEY = "seenNotificationIds";

function getSeenNotificationIds() {
  try {
    const raw = localStorage.getItem(SEEN_NOTIFICATIONS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSeenNotificationIds(ids) {
  try {
    localStorage.setItem(SEEN_NOTIFICATIONS_KEY, JSON.stringify(ids.slice(-300)));
  } catch {
    // ignore storage failures
  }
}

function Navbar() {

  const location = useLocation();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [refreshingApp, setRefreshingApp] = useState(false);
  const [seenNotificationIds, setSeenNotificationIds] = useState(() => getSeenNotificationIds());
  const roleName = String(user?.role?.name || user?.role || "").trim().toLowerCase();
  const isAdmin = roleName === "admin";

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

      const res = await API.get("/notifications");

      setNotifications(res.data);

    }
    catch (err) {

      console.error(err);

    }
    finally {

      setLoadingNotifications(false);

    }

  };

  const unreadCount = useMemo(() => {
    return notifications.filter((notification) => {
      const id = String(notification?._id || "");
      if (!id) return false;
      if (seenNotificationIds.includes(id)) return false;
      return notification.isRead !== true;
    }).length;
  }, [notifications, seenNotificationIds]);

  const markNotificationsSeen = async (items = []) => {
    const ids = items
      .map((item) => String(item?._id || ""))
      .filter(Boolean);

    if (ids.length === 0) return;

    const mergedIds = Array.from(new Set([...seenNotificationIds, ...ids]));
    setSeenNotificationIds(mergedIds);
    saveSeenNotificationIds(mergedIds);

    try {
      await API.put("/notifications/read-all");
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    } catch (err) {
      console.error("Failed to mark notifications as read:", err);
    }
  };


  useEffect(() => {
    fetchNotifications();

    const intervalId = window.setInterval(() => {
      fetchNotifications();
    }, 60000);

    return () => window.clearInterval(intervalId);

  }, []);


  useEffect(() => {

    if (showNotifications && unreadCount > 0 && notifications.length > 0)
      markNotificationsSeen(notifications);

  }, [showNotifications, notifications, unreadCount]);


  /* Module title */
  const moduleName = useMemo(() => {

    const currentPath = location.pathname;
    const query = new URLSearchParams(location.search);

    if (currentPath === "/leads/new") {
      return query.get("view") === "deal" ? "Add Deal" : "Add Lead";
    }

    if (currentPath.startsWith("/leads/")) {
      return query.get("view") === "deal" ? "Deal Details" : "Lead Details";
    }

    const sortedRoutes = [...routeConfig].sort(
      (a, b) => b.path.length - a.path.length
    );

    const route = sortedRoutes.find(r => {
      if (r.dynamic) {
        const base = r.path.replace("/:id", "");
        return currentPath.startsWith(base);
      }

      return currentPath === r.path;
    });

    return route?.title || "Dashboard";

  }, [location.pathname, location.search]);

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

  const handleGlobalRefresh = () => {

    if (refreshingApp) return;

    setRefreshingApp(true);
    window.location.reload();

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

    }, 60);

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

    }, 60);

  };


  /* NOTIFICATION hover handlers */
  const handleNotificationEnter = () => {

    if (notificationTimer.current)
      clearTimeout(notificationTimer.current);

    setShowNotifications(true);
    fetchNotifications();

  };

  const handleNotificationLeave = () => {

    notificationTimer.current = setTimeout(() => {

      setShowNotifications(false);

    }, 60);

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
        {isAdmin && (

          <div
            className="admin-menu-container"
            onMouseEnter={handleAdminEnter}
            onMouseLeave={handleAdminLeave}
          >

            <button className="nav-icon-btn">
              {"\u2699\uFE0F"}
            </button>

            <div className={`admin-dropdown ${showAdminMenu ? "visible" : "hidden"}`}>

              <div onClick={() => navigate("/products")}>
                Products
              </div>

              <div onClick={() => navigate("/taxes")}>
                Tax
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

              <div onClick={() => navigate("/organization")}>
                Organization
              </div>

              <div onClick={() => navigate("/quotation-clauses")}>
                Quotation Clauses
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
            {"\uD83D\uDD14"}
            {unreadCount > 0 ? (
              <span className="notification-badge">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
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

