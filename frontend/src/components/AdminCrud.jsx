import { useEffect, useState, useMemo } from "react";
import API from "../api";
import "../pages/modules/adminsetting/admin-config.css";

export default function AdminCrud({
  title,
  endpoint,
  columns
}) {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState([]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [filter, setFilter] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");

  useEffect(() => {
    fetchData();
  }, []);


  async function fetchData() {
    try {
      const res = await API.get(endpoint);
      setData(res.data || []);
    }catch {
      setData([]);
    }
  }

  function openAddForm() {
    setEditingId(null);
    const empty = {};
    columns.forEach(col => empty[col.field] = "");
    setForm(empty);
    setFormVisible(true);
  }

  function openEditForm(item) {
    setEditingId(item._id);
    setForm(item);
    setFormVisible(true);
  }

  async function save() {
    if (editingId)
      await API.put(`${endpoint}/${editingId}`, form);
    else
      await API.post(endpoint, form);

    setFormVisible(false);
    fetchData();
  }

  async function deleteOne(id) {

    if (!window.confirm("Delete item?")) return;

    await API.put(`${endpoint}/delete/${id}`);

    fetchData();

  }

  async function deleteSelected() {

    if (!window.confirm("Delete selected items?")) return;

    await Promise.all(
      selected.map(id =>
        API.put(`${endpoint}/delete/${id}`)
      )
    );

    setSelected([]);

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

    if (selected.length === data.length)
      setSelected([]);
    else
      setSelected(data.map(d => d._id));

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


  const processed = useMemo(() => {

    let list = [...data];

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

  }, [data, filter, sortField, sortOrder]);


  return (

    <div className="admin-config-page">

      <div className="admin-config-header">

        <h2>{title}</h2>

        <div className="admin-config-actions">

          <input
            placeholder="Search..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />

          {selected.length > 0 && (

            <button
              className="admin-config-btn admin-config-btn-danger"
              onClick={deleteSelected}
            >
              Delete Selected ({selected.length})
            </button>

          )}

          <button
            className="admin-config-btn"
            onClick={openAddForm}
          >
            Add
          </button>

        </div>

      </div>


      <table className="admin-config-table">

        <thead>

          <tr>

            <th>

              <input
                type="checkbox"
                checked={
                  selected.length === data.length &&
                  data.length > 0
                }
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
                  onChange={() => toggleSelect(item._id)}
                />

              </td>


              {columns.map(col => (

                <td key={col.field}>
                  {item[col.field]}
                </td>

              ))}


              <td>

                <button
                  className="admin-config-btn"
                  onClick={() => openEditForm(item)}
                >
                  Edit
                </button>

                <button
                  className="admin-config-btn admin-config-btn-danger"
                  onClick={() => deleteOne(item._id)}
                >
                  Delete
                </button>

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
                      setForm({
                        ...form,
                        [col.field]: e.target.value
                      })
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
                  placeholder={col.label}
                  value={form[col.field] || ""}
                  onChange={e =>
                    setForm({
                      ...form,
                      [col.field]: e.target.value
                    })
                  }
                />
              );

            })}

            <div className="admin-config-modal-actions">

              <button
                className="admin-config-btn"
                onClick={save}
              >
                Save
              </button>

              <button
                onClick={() => setFormVisible(false)}
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