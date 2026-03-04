import "./sideBar.css";
import { useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { useState } from "react";

export default function Sidebar() {

  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredPath, setHoveredPath] = useState("");

  // Decode user role from token
  const token = localStorage.getItem("token");

  let userRole = null;

  if (token) {
    const decoded = jwtDecode(token);
    userRole = decoded.role;
  }

  // Dynamic dashboard path
  let dashboardPath = "/userhome";
  if (userRole === "Admin") dashboardPath = "/adminhome";
  if (userRole === "Manager") dashboardPath = "/managerhome";


  const menuItems = [
    { name: "My Dashboard", icon: "📊", path: dashboardPath },

    { name: "Leads", icon: "🎯", path: "/leads" },
    { name: "Clients", icon: "👤", path: "/clients" },
    { name: "Deals", icon: "💼", path: "/deals" },
    { name: "Quotations", icon: "🧾", path: "/quotations" },

    { name: "Follow-ups", icon: "⏰", path: "/followups" },
    { name: "Daily Closing", icon: "🗓", path: "/daily-closing" },

    { name: "Sales Forecasting", icon: "📈", path: "/sales-forecast" },
    { name: "Expenses", icon: "💰", path: "/expenses" },

    { name: "AI Lead Gen", icon: "🤖", path: "/ai-leads" },
    { name: "Events & Expos", icon: "🎪", path: "/events" },

    // team-related links (visible to managers and admin)
    ...(userRole === "Manager" || userRole === "Admin" ? [{ name: "Team Dashboard", icon: "👥", path: "/team-dashboard" }] : []),
    { name: "Reports", icon: "📄", path: "/reports" },
    { name: "Settings", icon: "⚙️", path: "/settings" },
  ];


  return (
    <div className="sidebar">

      <div className="sidebar-header">
        <div className="sidebar-logo">AbhinavDCS CRM</div>
        <div className="sidebar-subtitle">
          AI-Powered Sales Platform
        </div>
      </div>

      <div className="sidebar-divider"></div>

      <div className="sidebar-menu">

        {menuItems.map((item, index) => {

          const isDealView = location.pathname.startsWith("/leads/") && location.search.includes("view=deal");

          let isActive = false;
          if (item.path === "/deals") {
            isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`) || isDealView;
          } else if (item.path === "/leads") {
            isActive = (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) && !isDealView;
          } else {
            isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          }

          const isFollowups = item.path === "/followups";
          const isFollowupsAddActive = location.pathname === "/followups/add";
          const showFollowupsAdd = isFollowups && (hoveredPath === item.path || isActive || isFollowupsAddActive);

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
