import "./sideBar.css";
import { useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

export default function Sidebar() {

  const navigate = useNavigate();
  const location = useLocation();

  // Decode user role from token
  const token = localStorage.getItem("token");

  let userRole = null;

  if (token) {
    const decoded = jwtDecode(token);
    userRole = decoded.role;
  }

  // Dynamic dashboard path
  const dashboardPath =
    userRole === "Admin" ? "/adminhome" : "/managerhome";


  const menuItems = [
    { name: "My Dashboard", icon: "📊", path: dashboardPath },

    { name: "Leads", icon: "🎯", path: "/leads" },
    { name: "Clients", icon: "👤", path: "/clients" },
    { name: "Deals", icon: "💼", path: "/deals" },
    { name: "Quotations", icon: "🧾", path: "/quotations" },

    { name: "Follow-ups", icon: "⏰", path: "/followups" },

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

          const isActive =
            location.pathname === item.path ||
            location.pathname.startsWith(`${item.path}/`);

          return (
            <div
              key={index}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-text">{item.name}</span>
            </div>
          );

        })}

      </div>

    </div>
  );
}
