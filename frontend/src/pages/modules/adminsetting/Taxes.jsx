import AdminCrud from "../../../components/AdminCrud";

export default function Taxes() {

  return (

    <AdminCrud
      title="Taxes"
      endpoint="/taxes"
      columns={[
        { field: "rate", label: "Rate %" }
      ]}
    />

  );

}
