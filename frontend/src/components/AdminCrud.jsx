import { useEffect, useState, useMemo } from "react";
import API from "../api";
import FormErrorSlot from "./FormErrorSlot";
import { getReadableErrorMessage } from "../utils/errorMessages";
import "../pages/modules/adminsetting/admin-config.css";

export default function AdminCrud({
  title,
  endpoint,
  columns,
  rowFilter,
  isRowProtected,
  protectedRowMessage,
  enableStatusTabs = false,
  statusParamName = "status",
  restoreActionPath = "activate"
}) {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState([]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [formError, setFormError] = useState("");
  const [statusTab, setStatusTab] = useState("active");

  const isProtected = (item) =>
    typeof isRowProtected === "function" && Boolean(isRowProtected(item));

  async function fetchData() {
    try {
      const params = enableStatusTabs
        ? { [statusParamName]: statusTab }
        : undefined;
      const res = await API.get(endpoint, params ? { params } : undefined);
      console.log("Fetched:", res.data);
      setData(res.data || []);
    }
    catch (err) {
      console.error("FETCH FAILED:", err);
      setData([]);
    }
  }

  function openAddForm() {
    setEditingId(null);
    setFormError("");
    const empty = {};
    columns.forEach(col => empty[col.field] = "");
    setForm(empty);
    setFormVisible(true);
  }

  function openEditForm(item) {
    if (isProtected(item)) {
      alert(protectedRowMessage || "This item is protected and cannot be edited");
      return;
    }
    setFormError("");
    setEditingId(item._id);
    setForm(item);
    setFormVisible(true);
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab, enableStatusTabs, statusParamName, endpoint]);

  async function save() {
    setFormError("");
    try {
      const missingRequired = columns.find((col) => {
        if (!col.required) return false;
        return String(form?.[col.field] ?? "").trim() === "";
      });
      if (missingRequired) {
        setFormError(`${missingRequired.label} is required`);
        return;
      }

      console.log("Saving:", form);
      let res;
      if (editingId)
        res = await API.put(`${endpoint}/${editingId}`, form);
      else
        res = await API.post(endpoint, form);
      console.log("Save response:", res.data);
      setFormVisible(false);
      setFormError("");
      fetchData();
    }catch (err) {
      console.error("SAVE FAILED:", err.response?.data || err.message);
      setFormError(getReadableErrorMessage(err, "Save failed."));
    }
  }

  async function deleteOne(id) {
    const item = (data || []).find((row) => String(row?._id || "") === String(id));
    if (item && isProtected(item)) {
      alert(protectedRowMessage || "This item is protected and cannot be deleted");
      return;
    }
    if (!window.confirm("Delete item?")) return;
    try {
      console.log("Deleting:", id);
      const res = await API.put(`${endpoint}/delete/${id}`);
      console.log("Delete response:", res.data);
      fetchData();
    } catch (err) {
      console.error("DELETE FAILED:", err.response?.data || err.message);
      alert(getReadableErrorMessage(err, "Delete failed."));
    }
  }

  async function deleteSelected() {

    if (!window.confirm("Delete selected items?")) return;

    const protectedIds = new Set(
      (data || [])
        .filter((item) => isProtected(item))
        .map((item) => String(item?._id || ""))
    );
    const allowedIds = selected.filter((id) => !protectedIds.has(String(id)));
    if (!allowedIds.length) {
      alert(protectedRowMessage || "Selected items are protected and cannot be deleted");
      return;
    }

    await Promise.all(
      allowedIds.map(id =>
        API.put(`${endpoint}/delete/${id}`)
      )
    );

    setSelected((prev) => prev.filter((id) => protectedIds.has(String(id))));

    fetchData();

  }

  function toggleSelect(id) {

    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );

  }


  function toggleSelectAll() {

    if (selectableIds.length === 0) {
      setSelected([]);
      return;
    }

    if (selectedSelectableCount === selectableIds.length) {
      setSelected(prev => prev.filter(id => !selectableIds.includes(id)));
      return;
    }

    setSelected(prev => [...new Set([...prev, ...selectableIds])]);

  }

  async function restoreOne(id) {
    if (!id) return;
    try {
      await API.put(`${endpoint}/${restoreActionPath}/${id}`);
      setSelected((prev) => prev.filter((x) => String(x) !== String(id)));
      fetchData();
    } catch (err) {
      console.error("RESTORE FAILED:", err.response?.data || err.message);
      alert(getReadableErrorMessage(err, "Restore failed."));
    }
  }


  function setSort(field) {

    if (sortField === field)
      setSortOrder(prev =>
        prev === "asc" ? "desc" : "asc"
      );
    else {

      setSortField(field);

      setSortOrder("asc");

    }

  }


  const visibleData = useMemo(() => {
    if (typeof rowFilter !== "function") return data;
    return (data || []).filter((item) => rowFilter(item));
  }, [data, rowFilter]);

  const selectableIds = useMemo(
    () =>
      visibleData
        .filter((item) => !isProtected(item))
        .map((item) => String(item?._id || ""))
        .filter(Boolean),
    [visibleData]
  );

  const selectedSelectableCount = useMemo(
    () => selectableIds.filter((id) => selected.includes(id)).length,
    [selectableIds, selected]
  );

  const processed = useMemo(() => {

    let list = [...visibleData];

    if (filter)
      list = list.filter(item =>
        Object.values(item).some(v =>
          String(v)
            .toLowerCase()
            .includes(filter.toLowerCase())
        )
      );

    if (sortField)
      list.sort((a, b) => {

        const A = a[sortField] || "";
        const B = b[sortField] || "";

        if (typeof A === "number")
          return sortOrder === "asc"
            ? A - B
            : B - A;

        return sortOrder === "asc"
          ? String(A).localeCompare(B)
          : String(B).localeCompare(A);

      });

    return list;

  }, [visibleData, filter, sortField, sortOrder]);


  return (

    <div className="admin-config-page">

      <div className="admin-config-header">
        {enableStatusTabs ? (
          <div className="admin-config-tabs" role="tablist" aria-label={`${title} status tabs`}>
            <button
              type="button"
              className={`admin-config-tab ${statusTab === "active" ? "active" : ""}`}
              onClick={() => {
                setStatusTab("active");
                setSelected([]);
              }}
            >
              Active
            </button>
            <button
              type="button"
              className={`admin-config-tab ${statusTab === "deleted" ? "active" : ""}`}
              onClick={() => {
                setStatusTab("deleted");
                setSelected([]);
              }}
            >
              Deleted
            </button>
          </div>
        ) : null}

        <div className="admin-config-actions">
          {statusTab !== "deleted" && selected.length > 0 && (
            <button
              className="admin-config-btn admin-config-btn-danger admin-config-bulk-delete-btn"
              onClick={deleteSelected}
            >
              Delete Selected ({selected.length})
            </button>
          )}

          {statusTab !== "deleted" ? (
            <button
              className="admin-config-btn"
              onClick={openAddForm}
            >
              Add
            </button>
          ) : null}

          <input
            className="app-search-input admin-search-input"
            placeholder="Search..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>

      </div>


      <table className="admin-config-table crm-auto-responsive-table">

        <thead>

          <tr>

            <th data-label="Select">

              <input
                type="checkbox"
                checked={
                  selectedSelectableCount === selectableIds.length &&
                  selectableIds.length > 0
                }
                disabled={statusTab === "deleted"}
                onChange={toggleSelectAll}
              />

            </th>

            {columns.map(col => (

              <th
                key={col.field}
                onClick={() => setSort(col.field)}
              >
                {col.label}
              </th>

            ))}

            <th>Actions</th>

          </tr>

        </thead>


        <tbody>

          {processed.length === 0 ? (

            <tr>

              <td
                colSpan={columns.length + 2}
                className="admin-config-empty"
              >
                No data found
              </td>

            </tr>

          ) : processed.map(item => (

            <tr key={item._id}>

              <td>

                <input
                  type="checkbox"
                  checked={selected.includes(item._id)}
                  disabled={isProtected(item) || statusTab === "deleted"}
                  onChange={() => toggleSelect(item._id)}
                />

              </td>


              {columns.map(col => (

                <td key={col.field}>
                  {col.render
                    ? col.render(item)
                    : item[col.field]}
                </td>

              ))}


              <td>

                {statusTab === "deleted" ? (
                  <button
                    className="admin-config-btn admin-config-btn-success"
                    onClick={() => restoreOne(item._id)}
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    <button
                      className="admin-config-btn"
                      disabled={isProtected(item)}
                      onClick={() => openEditForm(item)}
                    >
                      Edit
                    </button>

                    <button
                      className="admin-config-btn admin-config-btn-danger"
                      disabled={isProtected(item)}
                      onClick={() => deleteOne(item._id)}
                    >
                      Delete
                    </button>
                  </>
                )}

              </td>

            </tr>

          ))}

        </tbody>

      </table>


      {formVisible && (

        <div className="admin-config-modal">

          <div className="admin-config-modal-content">

            <h3>
              {editingId ? "Edit" : "Add"} {title}
            </h3>


            {columns.map(col => {

              if (col.type === "select") {

                return (
                  <select
                    key={col.field}
                    value={form[col.field] || ""}
                    onChange={e =>
                      {
                        setFormError("");
                        setForm({
                          ...form,
                          [col.field]: e.target.value
                        });
                      }
                    }
                  >

                    <option value="">
                      Select {col.label}
                    </option>

                    {col.options?.map(opt => (

                      <option
                        key={opt.value}
                        value={opt.value}
                      >
                        {opt.label}
                      </option>

                    ))}

                  </select>
                );

              }

              return (
                <input
                  key={col.field}
                  type={col.inputType || "text"}
                  placeholder={col.label}
                  value={form[col.field] || ""}
                  onChange={e =>
                    {
                      setFormError("");
                      setForm({
                        ...form,
                        [col.field]: e.target.value
                      });
                    }
                  }
                />
              );

            })}

            <FormErrorSlot
              message={formError}
              className="form-error-slot-global admin-config-form-error"
            />

            <div className="admin-config-modal-actions">

              <button
                className="admin-config-btn"
                onClick={save}
              >
                Save
              </button>

              <button
                onClick={() => {
                  setFormError("");
                  setFormVisible(false);
                }}
              >
                Cancel
              </button>

            </div>

          </div>

        </div>

      )}

    </div>

  );

}
