import AdminCrud from "../../../components/AdminCrud";

export default function Sources(){

  return (

    <AdminCrud
      title="Sources"
      endpoint="/sources"
      columns={[
        { field:"name", label:"Source Name" },
        { field:"url", label:"URL" }
      ]}
    />

  );

}