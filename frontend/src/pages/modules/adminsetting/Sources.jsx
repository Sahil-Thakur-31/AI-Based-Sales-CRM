import AdminCrud from "../../../components/AdminCrud";

const SYSTEM_SOURCE_NAMES = new Set(["reference", "event & expo"]);

function isSystemSource(item = {}) {
  const name = String(item?.name || "").trim().toLowerCase();
  return SYSTEM_SOURCE_NAMES.has(name);
}

export default function Sources(){

  return (

    <AdminCrud
      title="Sources"
      endpoint="/sources"
      columns={[
        { field:"name", label:"Source Name", required: true },
        { field:"url", label:"URL", required: true, inputType: "url" }
      ]}
      isRowProtected={isSystemSource}
      protectedRowMessage="Reference and Event & Expo are hardcoded system sources."
    />

  );

}
