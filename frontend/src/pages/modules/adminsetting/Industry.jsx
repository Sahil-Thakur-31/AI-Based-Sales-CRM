import AdminCrud from "../../../components/AdminCrud";

export default function Industry(){

  return (

    <AdminCrud
      title="Industry"
      endpoint="/industry"
      columns={[
        { field:"name", label:"Industry Name" },
        { field:"description", label:"Description" }
      ]}
    />

  );

}