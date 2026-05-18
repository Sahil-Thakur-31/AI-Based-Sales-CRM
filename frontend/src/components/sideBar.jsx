import { useEffect, useMemo, useState } from "react";
import "./sideBar.css";
import { useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import API from "../api";
import Logout from "./Logout";

function getInitials(name) {
  if (!name) return "?";

  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function resolvePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("blob:")) return photoUrl;
  if (photoUrl.startsWith("http")) return photoUrl;

  return `${API.defaults.baseURL.replace(/\/$/, "")}${photoUrl}`;
}

export default function Sidebar({
  isCollapsed = false,
  onToggleCollapse,
  isMobileViewport = false,
  isMobileOpen = false,
  onCloseMobile,
  organizationLogoUrl = "",
  organizationIconUrl = ""
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);

  const token = localStorage.getItem("token");
  let userRole = "";
  let userEmail = "";

  if (token) {
    try {
      const decoded = jwtDecode(token);
      userRole = decoded?.role || "";
      userEmail = decoded?.email || decoded?.sub || "";
    } catch (_err) {
      userRole = "";
      userEmail = "";
    }
  }

  const normalizedRole = String(localStorage.getItem("RoleName") || userRole || "")
    .trim()
    .toLowerCase();
  const isAdminOrManager = normalizedRole === "admin" || normalizedRole === "manager";
  const shouldCollapse = !isMobileViewport && isCollapsed;
  const brandImageUrl = shouldCollapse ? (organizationIconUrl || organizationLogoUrl) : organizationLogoUrl;

  useEffect(() => {
    let active = true;

    const fetchUser = async () => {
      try {
        const res = await API.get("/users/me");
        if (active) {
          setUser(res.data || null);
        }
      } catch (_err) {
        if (active) {
          setUser(null);
        }
      }
    };

    fetchUser();

    return () => {
      active = false;
    };
  }, []);

  let dashboardPath = "/userhome";
  if (normalizedRole === "admin") dashboardPath = "/adminhome";
  if (normalizedRole === "manager") dashboardPath = "/managerhome";

  const displayUser = useMemo(() => {
    const fallbackName = localStorage.getItem("Name") || "User";
    const resolvedRole = user?.role?.name || user?.role || localStorage.getItem("RoleName") || "Member";

    return {
      name: user?.name || fallbackName,
      email: user?.email || userEmail || String(resolvedRole).trim() || "AI-Based Sales CRM",
      role: resolvedRole,
      photoUrl: resolvePhotoUrl(user?.photoUrl || "")
    };
  }, [user, userEmail]);

  const menuItems = [
    { name: "My Dashboard", iconClass: "bi bi-columns-gap", path: dashboardPath },
    { name: "Leads", iconClass: "bi bi-person-plus", path: "/leads" },
    { name: "Clients", iconClass: "bi bi-people", path: "/clients" },
    { name: "Deals", iconClass: "bi bi-briefcase", path: "/deals" },
    { name: "Quotations", iconClass: "bi bi-receipt", path: "/quotations" },
    { name: "Follow-ups", iconClass: "bi bi-alarm", path: "/followups" },
    { name: "Sales Forecasting", iconClass: "bi bi-graph-up-arrow", path: "/sales-forecast" },
    { name: "Expenses", iconClass: "bi bi-cash-stack", path: "/expenses" },
    { name: "AI Lead Gen", iconClass: "bi bi-robot", path: "/ai-leads" },
    { name: "AI Insights", iconClass: "bi bi-stars", path: "/ai-insights" },
    { name: "Events & Expos", iconClass: "bi bi-calendar-event", path: "/events" },
    ...(isAdminOrManager ? [{ name: "Team Dashboard", iconClass: "bi bi-people-fill", path: "/team-dashboard" }] : []),
    { name: "Reports", iconClass: "bi bi-bar-chart-line", path: "/reports" },
    { name: "Settings", iconClass: "bi bi-gear", path: "/settings" }
  ];

  const handleNavigate = (path) => {
    navigate(path);

    if (isMobileViewport && onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <div
      className={`sidebar ${
        shouldCollapse ? "sidebar-collapsed" : ""
      } ${isMobileViewport ? "sidebar-mobile" : ""} ${isMobileOpen ? "mobile-open" : ""}`.trim()}
    >
      <div className="sidebar-header">
        {isMobileViewport ? (
          <button
            type="button"
            className="sidebar-mobile-profile-button"
            onClick={() => handleNavigate("/profile")}
          >
            <div className="sidebar-mobile-user">
              {displayUser.photoUrl ? (
                <img
                  className="sidebar-mobile-avatar"
                  src={displayUser.photoUrl}
                  alt={displayUser.name}
                />
              ) : (
                <div className="sidebar-mobile-avatar sidebar-mobile-avatar-fallback">
                  {getInitials(displayUser.name)}
                </div>
              )}

              <div className="sidebar-mobile-user-copy">
                <div className="sidebar-mobile-name">{displayUser.name}</div>
                <div className="sidebar-mobile-email">{displayUser.email}</div>
              </div>
            </div>
          </button>
        ) : (
          <div className="sidebar-brand">
            {brandImageUrl ? (
              <img
                className={`sidebar-logo-image ${shouldCollapse ? "sidebar-logo-image-icon" : ""}`.trim()}
                src={brandImageUrl}
                alt="Organization logo"
              />
            ) : (
              <div className="sidebar-logo-placeholder" aria-hidden="true">
                CRM
              </div>
            )}
            <div className="sidebar-subtitle">AI-Powered Sales Platform</div>
          </div>
        )}

        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={isMobileViewport ? onCloseMobile : onToggleCollapse}
          title={isMobileViewport ? "Close menu" : shouldCollapse ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={isMobileViewport ? "Close menu" : shouldCollapse ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isMobileViewport ? "\u00D7" : shouldCollapse ? "\u25B8" : "\u25C2"}
        </button>
      </div>

      <div className="sidebar-divider"></div>

      <div className="sidebar-menu">
        {menuItems.map((item, index) => {
          const managerOnlyPaths = ["/ai-leads", "/reports", "/sales-forecast"];
          if (!isAdminOrManager && managerOnlyPaths.includes(item.path)) {
            return null;
          }
          if (normalizedRole === "admin" && item.path.startsWith("/daily-closing")) {
            return null;
          }

          const isDealView =
            location.pathname.startsWith("/leads/") && location.search.includes("view=deal");

          let isActive = false;
          if (item.path === "/deals") {
            isActive =
              location.pathname === item.path ||
              location.pathname.startsWith(`${item.path}/`) ||
              isDealView;
          } else if (item.path === "/leads") {
            isActive =
              (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) &&
              !isDealView;
          } else {
            isActive =
              location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          }

          const isFollowups = item.path === "/followups";
          const isFollowupsAddActive = location.pathname === "/followups/add";

          return (
            <div key={index} className="sidebar-item-wrap">
              <div
                className={`sidebar-item ${
                  (isActive || (isFollowups && isFollowupsAddActive)) ? "active" : ""
                } ${isFollowups && !shouldCollapse ? "with-quick-add" : ""}`}
                onClick={() => handleNavigate(item.path)}
                title={shouldCollapse ? item.name : ""}
                aria-label={item.name}
              >
                <span className="sidebar-item-left">
                  <span className="sidebar-icon"><i className={item.iconClass} /></span>
                  <span className="sidebar-text">{item.name}</span>
                </span>

                {isFollowups && !shouldCollapse ? (
                  <button
                    type="button"
                    className={`sidebar-item-quick-add ${isFollowupsAddActive ? "active" : ""}`}
                    title="Add Follow-up/Meeting"
                    aria-label="Add Follow-up/Meeting"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleNavigate("/followups/add");
                    }}
                  >
                    <i className="bi bi-plus-lg" />
                    <span className="sidebar-item-quick-add-label">Add</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {isMobileViewport ? (
        <div className="sidebar-mobile-footer">
          <Logout className="sidebar-mobile-logout">Logout</Logout>
        </div>
      ) : null}
    </div>
  );
}
