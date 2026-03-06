import { useEffect, useMemo, useState } from "react";
import AdminCrud from "../../../components/AdminCrud";
import API from "../../../api";
import { jwtDecode } from "jwt-decode";

export default function ManageUsers() {

  const [roles, setRoles] = useState([]);
  const currentUserId = useMemo(() => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return "";
      const decoded = jwtDecode(token);
      return String(decoded?._id || "");
    } catch (_err) {
      return "";
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {

    try {
      const res = await API.get("/roles");
      setRoles(res.data);
    }
    catch (err) {
      console.error(err);
    }

  }

  return (
    <AdminCrud
      title="Users"
      endpoint="/users"
      rowFilter={(item) => String(item?._id || "") !== currentUserId}
      columns={[
        { field: "name", label: "Name" },
        { field: "email", label: "Email" },
        {
          field: "role",
          label: "Role",
          type: "select",
          options: roles.map(r => ({
            label: r.name,
            value: r._id
          })),
          render: (item) => item.roleName || "—"
        }
      ]}
    />
  );

}
