import "./sideBar.css";
import { useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { useEffect, useState } from "react";
import API from "../api";

export default function Sidebar({ isCollapsed = false, onToggleCollapse }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState("");

  useEffect(() => {
    let active = true;

    const resolveAssetUrl = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("blob:")) {
        return raw;
      }
      const normalized = raw.replace(/\\/g, "/");
      const base = String(API.defaults.baseURL || "").replace(/\/?$/, "/");
      try {
        return new URL(normalized, base).toString();
      } catch (_err) {
        return `${String(API.defaults.baseURL || "").replace(/\/$/, "")}${
          normalized.startsWith("/") ? "" : "/"
        }${normalized}`;
      }
    };

    const loadOrganizationLogo = async () => {
      try {
        const res = await API.get("/organizations/profile");
        if (!active) return;
        const logoUrl = resolveAssetUrl(res.data?.organization?.logoUrl || "");
        setOrganizationLogoUrl(logoUrl);
      } catch (_err) {
        if (!active) return;
        setOrganizationLogoUrl("");
      }
    };

    loadOrganizationLogo();
    return () => {
      active = false;
    };
  }, []);

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

  return (
    <div className={`sidebar ${isCollapsed ? "sidebar-collapsed" : ""}`.trim()}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          {organizationLogoUrl ? (
            <img className="sidebar-logo-image" src={organizationLogoUrl} alt="Organization logo" />
          ) : (
            <div className="sidebar-logo-placeholder" aria-hidden="true">
              🏢
            </div>
          )}
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
          const managerOnlyPaths = ["/ai-leads", "/reports", "/sales-forecast"];
          if (!isAdminOrManager && managerOnlyPaths.includes(item.path)) {
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
                } ${isFollowups && !isCollapsed ? "with-quick-add" : ""}`}
                onClick={() => navigate(item.path)}
                title={isCollapsed ? item.name : ""}
                aria-label={item.name}
              >
                <span className="sidebar-item-left">
                  <span className="sidebar-icon"><i className={item.iconClass} /></span>
                  <span className="sidebar-text">{item.name}</span>
                </span>

                {isFollowups && !isCollapsed ? (
                  <button
                    type="button"
                    className={`sidebar-item-quick-add ${isFollowupsAddActive ? "active" : ""}`}
                    title="Add Follow-up/Meeting"
                    aria-label="Add Follow-up/Meeting"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate("/followups/add");
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
    </div>
  );
}
