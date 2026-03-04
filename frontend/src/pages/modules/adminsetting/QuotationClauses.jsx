import { useEffect, useMemo, useState } from "react";
import API from "../../../api";
import "./admin-config.css";

const EMPTY_FORM = {
  scopeType: "global",
  industryId: "",
  productCategory: "",
  termsAndConditions: "",
  priority: 100
};

function normalizeText(value) {
  return String(value || "").trim();
}

function getScopeLabel(row) {
  if (row.scopeType === "industry") {
    return row.industryName ? `Industry: ${row.industryName}` : "Industry";
  }
  if (row.scopeType === "product_category") {
    return row.productCategory ? `Product Category: ${row.productCategory}` : "Product Category";
  }
  return "Global";
}

export default function QuotationClauses() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clauses, setClauses] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filter, setFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [globalPaymentTerms, setGlobalPaymentTerms] = useState("");
  const [paymentTermsSaving, setPaymentTermsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [clausesRes, industriesRes, productsRes, paymentTermsRes] = await Promise.all([
        API.get("/quotation-clauses"),
        API.get("/industries"),
        API.get("/products"),
        API.get("/quotation-clauses/payment-terms")
      ]);

      const clauseRows = clausesRes.data || [];
      const industryRows = industriesRes.data || [];
      const productRows = productsRes.data || [];

      const categoryRows = [
        ...new Set(
          productRows.map((row) => normalizeText(row.category)).filter(Boolean)
        )
      ].sort((a, b) => a.localeCompare(b));

      setClauses(clauseRows);
      setIndustries(industryRows);
      setCategories(categoryRows);
      setGlobalPaymentTerms(paymentTermsRes.data?.paymentTerms || "");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to load quotation clauses");
    } finally {
      setLoading(false);
    }
  }

  function openAddModal() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setModalOpen(true);
    setError("");
  }

  function openEditModal(row) {
    setEditingId(row._id);
    setForm({
      scopeType: row.scopeType || "global",
      industryId: row.industryId || "",
      productCategory: row.productCategory || "",
      termsAndConditions: row.termsAndConditions || "",
      priority: Number(row.priority || 100)
    });
    setModalOpen(true);
    setError("");
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId("");
    setForm(EMPTY_FORM);
    setError("");
  }

  async function saveClause() {
    try {
      setSaving(true);
      setError("");

      const payload = {
        scopeType: form.scopeType,
        industryId: form.scopeType === "industry" ? form.industryId : "",
        productCategory: form.scopeType === "product_category" ? form.productCategory : "",
        termsAndConditions: form.termsAndConditions,
        priority: Number(form.priority || 100)
      };

      if (editingId) {
        await API.put(`/quotation-clauses/${editingId}`, payload);
      } else {
        await API.post("/quotation-clauses", payload);
      }

      closeModal();
      loadData();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save quotation clause");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClause(id) {
    const confirmed = window.confirm("Delete this quotation clause?");
    if (!confirmed) return;

    try {
      await API.put(`/quotation-clauses/delete/${id}`);
      loadData();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to delete quotation clause");
    }
  }

  async function savePaymentTerms() {
    try {
      setPaymentTermsSaving(true);
      setError("");
      await API.put("/quotation-clauses/payment-terms", {
        paymentTerms: globalPaymentTerms
      });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save payment terms");
    } finally {
      setPaymentTermsSaving(false);
    }
  }

  const filteredRows = useMemo(() => {
    const text = normalizeText(filter).toLowerCase();
    if (!text) return clauses;

    return clauses.filter((row) => {
      const haystack = [
        row.scopeType,
        row.industryName,
        row.productCategory,
        row.termsAndConditions
      ]
        .map((value) => normalizeText(value).toLowerCase())
        .join(" ");

      return haystack.includes(text);
    });
  }, [clauses, filter]);

  return (
    <div className="admin-config-page">
      <div className="admin-config-header">
        <div className="admin-config-actions">
          <input
            className="app-search-input admin-search-input"
            placeholder="Search quotation clauses..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="admin-config-btn" onClick={openAddModal}>
            Add Clause
          </button>
        </div>
      </div>

      <div className="org-profile-shell">
        <div className="org-profile-header">
          <h3>Common Payment Terms</h3>
        </div>
        <div className="org-profile-field">
          <textarea
            rows={4}
            value={globalPaymentTerms}
            onChange={(e) => setGlobalPaymentTerms(e.target.value)}
            placeholder="This payment terms text is common for all quotations."
          />
        </div>
        <div className="admin-config-modal-actions">
          <button className="admin-config-btn" onClick={savePaymentTerms} disabled={paymentTermsSaving}>
            {paymentTermsSaving ? "Saving..." : "Save Payment Terms"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="admin-config-empty">Loading quotation clauses...</div>
      ) : (
        <table className="admin-config-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Terms & Conditions</th>
              <th>Priority</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="admin-config-empty">
                  No quotation clauses found
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row._id}>
                  <td>{getScopeLabel(row)}</td>
                  <td>{row.termsAndConditions || "-"}</td>
                  <td>{Number(row.priority || 100)}</td>
                  <td>
                    <button className="admin-config-btn" onClick={() => openEditModal(row)}>
                      Edit
                    </button>
                    <button
                      className="admin-config-btn admin-config-btn-danger"
                      onClick={() => deleteClause(row._id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {modalOpen ? (
        <div className="admin-config-modal">
          <div className="admin-config-modal-content org-modal">
            <h3>{editingId ? "Edit Quotation Clause" : "Add Quotation Clause"}</h3>

            <div className="org-three-field-row">
              <div className="org-profile-field">
                <label>Scope</label>
                <select
                  value={form.scopeType}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      scopeType: e.target.value
                    }))
                  }
                >
                  <option value="global">Global</option>
                  <option value="industry">Industry</option>
                  <option value="product_category">Product Category</option>
                </select>
              </div>

              {form.scopeType === "industry" ? (
                <div className="org-profile-field">
                  <label>Industry</label>
                  <select
                    value={form.industryId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        industryId: e.target.value
                      }))
                    }
                  >
                    <option value="">Select industry</option>
                    {industries.map((industry) => (
                      <option key={industry._id} value={industry._id}>
                        {industry.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {form.scopeType === "product_category" ? (
                <div className="org-profile-field">
                  <label>Product Category</label>
                  <input
                    list="quotation-category-options"
                    value={form.productCategory}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        productCategory: e.target.value
                      }))
                    }
                    placeholder="Enter product category"
                  />
                  <datalist id="quotation-category-options">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              <div className="org-profile-field">
                <label>Priority</label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: e.target.value
                    }))
                  }
                />
                <small>Lower number = higher priority (1 is higher than 100).</small>
              </div>
            </div>

            <div className="org-profile-field">
              <label>Terms & Conditions</label>
              <textarea
                rows={6}
                value={form.termsAndConditions}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    termsAndConditions: e.target.value
                  }))
                }
                placeholder="Enter terms and conditions..."
              />
            </div>

            {error ? <div className="quote-form-error">{error}</div> : null}

            <div className="admin-config-modal-actions">
              <button className="admin-config-btn" onClick={saveClause} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button className="admin-config-btn org-btn-secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
