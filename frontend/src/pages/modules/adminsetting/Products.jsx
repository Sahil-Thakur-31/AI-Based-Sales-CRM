import AdminCrud from "../../../components/AdminCrud";

export default function Products(){

  return (

    <AdminCrud
      title="Products"
      endpoint="/products"
      columns={[
        { field:"name", label:"Name" },
        { field:"category", label:"Category" },
        { field:"price", label:"Price" },
        { field:"taxPercent", label:"Tax %" }
      ]}
    />

  );

}