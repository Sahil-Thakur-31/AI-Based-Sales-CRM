import { useNavigate } from "react-router-dom";

function Logout({ children, className }) {

  const navigate = useNavigate();

  const handleLogout = () => {

    localStorage.removeItem("token");
    localStorage.removeItem("Name");
    localStorage.removeItem("RoleName");

    navigate("/login", { replace: true });

  };

  return (

    <div
      onClick={handleLogout}
      className={className}
      style={{ cursor: "pointer" }}
    >
      {children || "Logout"}
    </div>

  );

}

export default Logout;