import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./sideBar";
import Navbar from "./navBar.jsx";
import "./layout.css"

const MOBILE_LAYOUT_QUERY = "(max-width: 900px)";

function Layout({ organizationLogoUrl = "", organizationIconUrl = "" }) {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved === null ? false : saved === "true";
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const handleChange = (event) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    const shouldLockScroll = isMobileViewport && isMobileSidebarOpen;
    document.body.classList.toggle("mobile-sidebar-open", shouldLockScroll);

    return () => {
      document.body.classList.remove("mobile-sidebar-open");
    };
  }, [isMobileSidebarOpen, isMobileViewport]);

  return (
    <div
      className={`layout-container ${
        isSidebarCollapsed ? "sidebar-collapsed" : ""
      } ${isMobileSidebarOpen ? "mobile-sidebar-open" : ""}`.trim()}
    >

      <Sidebar
        isCollapsed={isSidebarCollapsed}
        isMobileViewport={isMobileViewport}
        isMobileOpen={isMobileSidebarOpen}
        organizationLogoUrl={organizationLogoUrl}
        organizationIconUrl={organizationIconUrl}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <button
        type="button"
        className={`sidebar-overlay ${isMobileSidebarOpen ? "visible" : ""}`.trim()}
        aria-label="Close navigation menu"
        onClick={() => setIsMobileSidebarOpen(false)}
      />

      <div className="main-container">

        <Navbar
          isMobileViewport={isMobileViewport}
          onOpenSidebar={() => setIsMobileSidebarOpen(true)}
        />

        <div className="page-content">
          <Outlet />
        </div>

      </div>

    </div>
  );
}

export default Layout;
