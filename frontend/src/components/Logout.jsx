import { useNavigate } from "react-router-dom";

export default function Logout({ children, className }) {

  const navigate = useNavigate();

  const handleLogout = () => {

    localStorage.removeItem("token");
    localStorage.removeItem("Name");
    localStorage.removeItem("RoleName");

    navigate("/login", { replace: true });

  };

  return (

    <button
      onClick={handleLogout}
      className={className}
    >
      {children || "Logout"}
    </button>

  );

}