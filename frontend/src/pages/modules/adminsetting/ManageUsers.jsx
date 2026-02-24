import { useEffect, useState } from "react";
import AdminCrud from "../../../components/AdminCrud";
import API from "../../../api";

export default function ManageUsers() {

  const [roles, setRoles] = useState([]);

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    const res = await API.get("/roles");
    setRoles(res.data);
  }

  return (
    <AdminCrud
      title="Users"
      endpoint="/users"
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
          }))
        }
      ]}
    />
  );

}