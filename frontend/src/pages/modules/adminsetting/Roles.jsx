import AdminCrud from "../../../components/AdminCrud";

export default function Roles(){

  return (

    <AdminCrud
      title="Roles"
      endpoint="/roles"
      columns={[
        { field:"name", label:"Role Name" },
        { field:"description", label:"Description" }
      ]}
    />

  );

}