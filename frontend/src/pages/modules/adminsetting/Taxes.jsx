import AdminCrud from "../../../components/AdminCrud";

export default function Taxes() {
  return (
    <AdminCrud
      title="Taxes"
      endpoint="/taxes"
      enableStatusTabs
      restoreActionPath="activate"
      columns={[
        { field: "rate", label: "Tax %" }
      ]}
    />
  );
}
