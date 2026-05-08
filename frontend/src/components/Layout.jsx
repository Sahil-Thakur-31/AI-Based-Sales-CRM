import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./sideBar";
import Navbar from "./navBar.jsx";
import "./layout.css"

function Layout({ organizationLogoUrl = "", organizationIconUrl = "" }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved === null ? false : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  return (
    <div className={`layout-container ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`.trim()}>

      <Sidebar
        isCollapsed={isSidebarCollapsed}
        organizationLogoUrl={organizationLogoUrl}
        organizationIconUrl={organizationIconUrl}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      <div className="main-container">

        <Navbar />

        <div className="page-content">
          <Outlet />
        </div>

      </div>

    </div>
  );
}

export default Layout;
