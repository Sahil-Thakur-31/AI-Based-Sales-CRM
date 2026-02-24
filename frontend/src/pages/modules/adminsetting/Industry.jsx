import AdminCrud from "../../../components/AdminCrud";

export default function Industry(){

  return (

    <AdminCrud
      title="Industries"
      endpoint="/industries"
      columns={[
        { field:"name", label:"Industry" },
        { field:"description", label:"Description" }
      ]}
    />

  );

}