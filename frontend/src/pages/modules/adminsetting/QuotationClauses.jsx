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

function getScopeClass(scopeType) {
  const value = String(scopeType || "").toLowerCase();
  if (value === "industry") return "qc-scope-industry";
  if (value === "product_category") return "qc-scope-product";
  return "qc-scope-global";
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
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [globalPaymentTerms, setGlobalPaymentTerms] = useState("");
  const [paymentTermsSaving, setPaymentTermsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusTab, setStatusTab] = useState("active");

  useEffect(() => {
    loadData();
  }, [statusTab]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [clausesRes, industriesRes, productsRes, paymentTermsRes] = await Promise.all([
        API.get("/quotation-clauses", { params: { status: statusTab } }),
        API.get("/industries"),
        API.get("/products"),
        API.get("/quotation-clauses/payment-terms")
      ]);

      const clauseRows = clausesRes.data || [];
      const industryRows = industriesRes.data || [];
      const productRows = productsRes.data || [];

      const categoryRows = [
        ...new Set(productRows.map((row) => normalizeText(row.category)).filter(Boolean))
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
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
    setError("");
    setNotice("");
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
    setNotice("");
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId("");
    setForm({ ...EMPTY_FORM });
    setError("");
  }

  async function saveClause() {
    try {
      setSaving(true);
      setError("");
      setNotice("");

      const payload = {
        scopeType: form.scopeType,
        industryId: form.scopeType === "industry" ? form.industryId : "",
        productCategory: form.scopeType === "product_category" ? form.productCategory : "",
        termsAndConditions: form.termsAndConditions,
        priority: Number(form.priority || 100)
      };

      if (editingId) {
        await API.put(`/quotation-clauses/${editingId}`, payload);
        setNotice("Clause updated successfully");
      } else {
        await API.post("/quotation-clauses", payload);
        setNotice("Clause created successfully");
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
      setError("");
      setNotice("");
      await API.put(`/quotation-clauses/delete/${id}`);
      setNotice("Clause deleted successfully");
      loadData();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to delete quotation clause");
    }
  }

  async function savePaymentTerms() {
    try {
      setPaymentTermsSaving(true);
      setError("");
      setNotice("");
      await API.put("/quotation-clauses/payment-terms", {
        paymentTerms: globalPaymentTerms
      });
      setNotice("Common payment terms saved");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to save payment terms");
    } finally {
      setPaymentTermsSaving(false);
    }
  }

  async function restoreClause(id) {
    const confirmed = window.confirm("Restore this quotation clause?");
    if (!confirmed) return;

    try {
      setError("");
      setNotice("");
      await API.put(`/quotation-clauses/restore/${id}`);
      setNotice("Clause restored successfully");
      loadData();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to restore quotation clause");
    }
  }

  const filteredRows = useMemo(() => {
    const text = normalizeText(filter).toLowerCase();
    if (!text) return clauses;

    return clauses.filter((row) => {
      const haystack = [row.scopeType, row.industryName, row.productCategory, row.termsAndConditions]
        .map((value) => normalizeText(value).toLowerCase())
        .join(" ");

      return haystack.includes(text);
    });
  }, [clauses, filter]);

  const scopeStats = useMemo(() => {
    const stats = {
      total: clauses.length,
      global: 0,
      industry: 0,
      product: 0
    };

    for (const row of clauses) {
      const scopeType = String(row.scopeType || "global").toLowerCase();
      if (scopeType === "industry") stats.industry += 1;
      else if (scopeType === "product_category") stats.product += 1;
      else stats.global += 1;
    }

    return stats;
  }, [clauses]);

  return (
    <div className="admin-config-page qc-page">
      {error ? <div className="quote-form-error">{error}</div> : null}
      {notice ? <div className="org-success-banner">{notice}</div> : null}

      <div className="qc-top-grid">
        <section className="org-profile-shell qc-panel qc-payment-panel">
          <div className="qc-panel-head">
            <div className="qc-panel-head-top">
              <h3>Payment Terms</h3>
              <button
                className="admin-config-btn"
                onClick={savePaymentTerms}
                disabled={paymentTermsSaving}
              >
                Save
              </button>
            </div>
          </div>

          <div className="org-profile-field">
            <textarea
              rows={6}
              value={globalPaymentTerms}
              onChange={(e) => setGlobalPaymentTerms(e.target.value)}
              placeholder="Enter one common payment terms block"
            />
          </div>
        </section>

        <section className="org-profile-shell qc-panel qc-rules-panel">
          <div className="qc-panel-head">
            <div className="qc-panel-head-top">
              <h3>Clause Rules</h3>
              <div className="qc-panel-actions">
                <div className="admin-config-tabs qc-status-tabs" role="tablist" aria-label="Quotation clause status tabs">
                  <button
                    type="button"
                    className={`admin-config-tab ${statusTab === "active" ? "active" : ""}`}
                    onClick={() => setStatusTab("active")}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    className={`admin-config-tab ${statusTab === "deleted" ? "active" : ""}`}
                    onClick={() => setStatusTab("deleted")}
                  >
                    Deleted
                  </button>
                </div>

                {statusTab !== "deleted" ? (
                  <button className="admin-config-btn" onClick={openAddModal}>
                    Add Clause
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="qc-stats-row">
            <div className="qc-stat-card">
              <span>Total</span>
              <strong>{scopeStats.total}</strong>
            </div>
            <div className="qc-stat-card">
              <span>Global</span>
              <strong>{scopeStats.global}</strong>
            </div>
            <div className="qc-stat-card">
              <span>Industry</span>
              <strong>{scopeStats.industry}</strong>
            </div>
            <div className="qc-stat-card">
              <span>Product</span>
              <strong>{scopeStats.product}</strong>
            </div>
          </div>

          <div className="qc-controls-row">
            <input
              className="app-search-input admin-search-input"
              placeholder="Search scope, category, terms..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </section>
      </div>

      <section className="qc-table-shell">
        {loading ? (
          <div className="admin-config-empty">Loading quotation clauses...</div>
        ) : (
          <table className="admin-config-table qc-table">
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
                    {statusTab === "deleted"
                      ? "No deleted quotation clauses found"
                      : "No quotation clauses found"}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row._id}>
                    <td>
                      <span className={`qc-scope-badge ${getScopeClass(row.scopeType)}`}>
                        {getScopeLabel(row)}
                      </span>
                    </td>
                    <td className="qc-terms-cell">{row.termsAndConditions || "-"}</td>
                    <td>
                      <span className="qc-priority-chip">{Number(row.priority || 100)}</span>
                    </td>
                    <td>
                      <div className="qc-action-row">
                        {statusTab === "deleted" ? (
                          <button
                            className="admin-config-btn admin-config-btn-success"
                            onClick={() => restoreClause(row._id)}
                          >
                            Restore
                          </button>
                        ) : (
                          <>
                            <button className="admin-config-btn" onClick={() => openEditModal(row)}>
                              Edit
                            </button>
                            <button
                              className="admin-config-btn admin-config-btn-danger"
                              onClick={() => deleteClause(row._id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>

      {modalOpen ? (
        <div className="admin-config-modal">
          <div className="admin-config-modal-content org-modal qc-modal">
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
                <small className="qc-priority-helper">Lower number = higher priority (1 beats 100).</small>
              </div>
            </div>

            <div className="org-profile-field">
              <label>Terms & Conditions</label>
              <textarea
                rows={7}
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

            <div className="admin-config-modal-actions">
              <button className="admin-config-btn" onClick={saveClause} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className="admin-config-btn org-btn-secondary"
                onClick={closeModal}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
