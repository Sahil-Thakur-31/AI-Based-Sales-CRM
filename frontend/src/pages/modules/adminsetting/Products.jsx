import { useEffect, useState, useMemo } from "react";
import API from "../../../api";
import "./products.css";

export default function Products() {

  const [products, setProducts] = useState([]);

  const [selected, setSelected] = useState([]);

  const [filterCategory, setFilterCategory] = useState("");

  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");

  const [formVisible, setFormVisible] = useState(false);

  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState({
    name: "",
    product_code: "",
    category: "",
    price: "",
    taxPercent: "",
    description: ""
  });



  useEffect(() => {

    fetchProducts();

  }, []);



  async function fetchProducts() {

    try {

      const res = await API.get("/products");

      setProducts(res.data || []);

    }
    catch {

      setProducts([]);

    }

  }



  function openAddForm() {

    setEditingId(null);

    setForm({
      name: "",
      product_code: "",
      category: "",
      price: "",
      taxPercent: "",
      description: ""
    });

    setFormVisible(true);

  }



  function openEditForm(product) {

    setEditingId(product._id);

    setForm(product);

    setFormVisible(true);

  }



  async function saveProduct() {

    if (editingId)
      await API.put(`/products/${editingId}`, form);
    else
      await API.post("/products", form);

    setFormVisible(false);

    fetchProducts();

  }



  async function deleteProduct(id) {

    if (!window.confirm("Delete this product?")) return;

    await API.delete(`/products/${id}`);

    fetchProducts();

  }



  async function deleteSelected() {

    if (!window.confirm("Delete selected products?")) return;

    await Promise.all(
      selected.map(id => API.delete(`/products/${id}`))
    );

    setSelected([]);

    fetchProducts();

  }



  function toggleSelect(id) {

    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );

  }



  function toggleSelectAll() {

    if (selected.length === products.length)
      setSelected([]);
    else
      setSelected(products.map(p => p._id));

  }



  const categories = useMemo(() => {

    return [...new Set(products.map(p => p.category))];

  }, [products]);



  const processedProducts = useMemo(() => {

    let list = [...products];



    if (filterCategory)
      list = list.filter(p => p.category === filterCategory);



    if (sortField) {

      list.sort((a, b) => {

        const valA = a[sortField] || "";
        const valB = b[sortField] || "";

        if (typeof valA === "number")
          return sortOrder === "asc"
            ? valA - valB
            : valB - valA;

        return sortOrder === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);

      });

    }



    return list;

  }, [products, filterCategory, sortField, sortOrder]);



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



  return (

    <div className="products-page">

      <div className="products-header">

        <h2>Products</h2>

        <div className="products-actions">

          <select
            value={filterCategory}
            onChange={e =>
              setFilterCategory(e.target.value)
            }
          >
            <option value="">All Categories</option>

            {categories.map(cat =>
              <option key={cat}>{cat}</option>
            )}

          </select>


          {selected.length > 0 && (

            <button
              className="danger"
              onClick={deleteSelected}
            >
              Delete Selected ({selected.length})
            </button>

          )}


          <button onClick={openAddForm}>
            Add Product
          </button>

        </div>

      </div>



      <table className="products-table">

        <thead>

          <tr>

            <th>
              <input
                type="checkbox"
                checked={
                  selected.length === products.length &&
                  products.length > 0
                }
                onChange={toggleSelectAll}
              />
            </th>


            <th onClick={() => setSort("name")}>
              Name
            </th>

            <th onClick={() => setSort("product_code")}>
              Code
            </th>

            <th onClick={() => setSort("category")}>
              Category
            </th>

            <th onClick={() => setSort("price")}>
              Price
            </th>

            <th>Tax</th>

            <th>Actions</th>

          </tr>

        </thead>


        <tbody>

          {processedProducts.length === 0 ? (

            <tr>

              <td colSpan="7" className="empty">

                No products found

              </td>

            </tr>

          ) : processedProducts.map(product => (

            <tr key={product._id}>

              <td>

                <input
                  type="checkbox"
                  checked={
                    selected.includes(product._id)
                  }
                  onChange={() =>
                    toggleSelect(product._id)
                  }
                />

              </td>

              <td>{product.name}</td>

              <td>{product.product_code}</td>

              <td>{product.category}</td>

              <td>₹ {product.price}</td>

              <td>{product.taxPercent}%</td>

              <td>

                <button
                  onClick={() =>
                    openEditForm(product)
                  }
                >
                  Edit
                </button>

                <button
                  className="danger"
                  onClick={() =>
                    deleteProduct(product._id)
                  }
                >
                  Delete
                </button>

              </td>

            </tr>

          ))}

        </tbody>

      </table>



      {formVisible && (

        <div className="modal">

          <div className="modal-content">

            <h3>
              {editingId
                ? "Edit Product"
                : "Add Product"}
            </h3>

            <input
              placeholder="Name"
              value={form.name}
              onChange={e =>
                setForm({...form, name: e.target.value})
              }
            />

            <input
              placeholder="Code"
              value={form.product_code}
              onChange={e =>
                setForm({...form, product_code: e.target.value})
              }
            />

            <input
              placeholder="Category"
              value={form.category}
              onChange={e =>
                setForm({...form, category: e.target.value})
              }
            />

            <input
              type="number"
              placeholder="Price"
              value={form.price}
              onChange={e =>
                setForm({...form, price: e.target.value})
              }
            />

            <input
              type="number"
              placeholder="Tax %"
              value={form.taxPercent}
              onChange={e =>
                setForm({...form, taxPercent: e.target.value})
              }
            />

            <textarea
              placeholder="Description"
              value={form.description}
              onChange={e =>
                setForm({...form, description: e.target.value})
              }
            />


            <div className="modal-buttons">

              <button onClick={saveProduct}>
                Save
              </button>

              <button
                onClick={() =>
                  setFormVisible(false)
                }
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