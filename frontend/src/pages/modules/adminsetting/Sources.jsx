import AdminCrud from "../../../components/AdminCrud";

function normalizeSourceName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ");
}

const SYSTEM_SOURCE_NAMES = new Set(["reference", "event and expo"]);

function isSystemSource(item = {}) {
  const name = normalizeSourceName(item?.name);
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
      rowFilter={(item) => !isSystemSource(item)}
      isRowProtected={isSystemSource}
      protectedRowMessage="Reference and Event & Expo are hardcoded system sources."
    />

  );

}
