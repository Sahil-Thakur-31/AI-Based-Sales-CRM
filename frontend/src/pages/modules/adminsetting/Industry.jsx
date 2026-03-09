import AdminCrud from "../../../components/AdminCrud";

export default function Industry(){

  return (

    <AdminCrud
      title="Industries"
      endpoint="/industries"
      enableStatusTabs
      restoreActionPath="activate"
      columns={[
        { field:"name", label:"Industry" },
        { field:"description", label:"Description" }
      ]}
    />

  );

}
