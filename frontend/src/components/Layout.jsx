import { Outlet } from "react-router-dom";
import Sidebar from "./sideBar";
import Navbar from "./navBar.jsx";
import "./layout.css"
import {jwtDecode} from "jwt-decode"

function Layout() {

  const token = localStorage.getItem("token");
  let user = null;

  if (token) {
    const decoded = jwtDecode(token);

    user = {
      id: decoded._id,
      email: decoded.email,
      role: decoded.role,
      name: localStorage.getItem("Name"),
      avatar: null
    };
  }

  return (
    <div className="layout-container">

      <Sidebar />

      <div className="main-container">

        <Navbar user={user} />

        <div className="page-content">
          <Outlet />
        </div>

      </div>

    </div>
  );
}

export default Layout;
