import "./sideBar.css";
import { useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { useState } from "react";

export default function Sidebar({ isCollapsed = false, onToggleCollapse }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredPath, setHoveredPath] = useState("");

  const token = localStorage.getItem("token");
  let userRole = "";

  if (token) {
    try {
      const decoded = jwtDecode(token);
      userRole = decoded?.role || "";
    } catch (_err) {
      userRole = "";
    }
  }

  const normalizedRole = String(localStorage.getItem("RoleName") || userRole || "")
    .trim()
    .toLowerCase();
  const isAdminOrManager = normalizedRole === "admin" || normalizedRole === "manager";

  let dashboardPath = "/userhome";
  if (normalizedRole === "admin") dashboardPath = "/adminhome";
  if (normalizedRole === "manager") dashboardPath = "/managerhome";

  const menuItems = [
    { name: "My Dashboard", icon: "\u{1F4CA}", path: dashboardPath },
    { name: "Leads", icon: "\u{1F3AF}", path: "/leads" },
    { name: "Clients", icon: "\u{1F464}", path: "/clients" },
    { name: "Deals", icon: "\u{1F4BC}", path: "/deals" },
    { name: "Quotations", icon: "\u{1F9FE}", path: "/quotations" },
    { name: "Follow-ups", icon: "\u23F0", path: "/followups" },
    { name: "Sales Forecasting", icon: "\u{1F4C8}", path: "/sales-forecast" },
    { name: "Expenses", icon: "\u{1F4B0}", path: "/expenses" },
    { name: "AI Lead Gen", icon: "\u{1F916}", path: "/ai-leads" },
    { name: "Events & Expos", icon: "\u{1F3AA}", path: "/events" },
    ...(isAdminOrManager ? [{ name: "Team Dashboard", icon: "\u{1F465}", path: "/team-dashboard" }] : []),
    { name: "Reports", icon: "\u{1F4C4}", path: "/reports" },
    { name: "Settings", icon: "\u2699\uFE0F", path: "/settings" }
  ];

  return (
    <div className={`sidebar ${isCollapsed ? "sidebar-collapsed" : ""}`.trim()}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-logo">AbhinavDCS CRM</div>
          <div className="sidebar-subtitle">AI-Powered Sales Platform</div>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? "\u25B8" : "\u25C2"}
        </button>
      </div>

      <div className="sidebar-divider"></div>

      <div className="sidebar-menu">
        {menuItems.map((item, index) => {
          const restrictedPaths = ["/ai-leads", "/reports", "/sales-forecast"];
          if (!isAdminOrManager && restrictedPaths.includes(item.path)) {
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
          const showFollowupsAdd =
            !isCollapsed && isFollowups && (hoveredPath === item.path || isActive || isFollowupsAddActive);

          return (
            <div
              key={index}
              className="sidebar-item-wrap"
              onMouseEnter={() => setHoveredPath(item.path)}
              onMouseLeave={() => setHoveredPath("")}
            >
              <div
                className={`sidebar-item ${(isActive || (isFollowups && isFollowupsAddActive)) ? "active" : ""}`}
                onClick={() => navigate(item.path)}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-text">{item.name}</span>
              </div>

              {showFollowupsAdd && (
                <div
                  className={`sidebar-subitem ${isFollowupsAddActive ? "active" : ""}`}
                  onClick={() => navigate("/followups/add")}
                >
                  + Add
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
