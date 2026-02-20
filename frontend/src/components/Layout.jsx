import { Outlet } from "react-router-dom";
import Sidebar from "./sideBar";
import Navbar from "./navBar.jsx";
import "./layout.css"

function Layout() {

  return (
    <div className="layout-container">

      <Sidebar />

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
