import { Navigate, useSearchParams } from "react-router-dom";
import TeamTargetsAdmin from "./TeamTargetsAdmin";
import TeamTargetsManager from "./TeamTargetsManager";

export default function TeamTargets() {
  const [searchParams] = useSearchParams();
  const roleName = String(localStorage.getItem("RoleName") || "").trim();

  if (roleName === "Admin") {
    return <TeamTargetsAdmin />;
  }

  if (roleName === "Manager") {
    const teamId = String(searchParams.get("teamId") || "").trim();
    if (!teamId) {
      return <Navigate to="/team-dashboard" replace />;
    }
    return <TeamTargetsManager />;
  }

  return <Navigate to="/userhome" replace />;
}
