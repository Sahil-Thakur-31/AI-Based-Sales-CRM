import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Quotations.css";

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function todayAsInputDate() {
  return new Date().toISOString().split("T")[0];
}

function makeEmptyItem() {
  return {
    productId: "",
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    taxId: ""
  };
}

function getDealDisplayName(deal) {
  if (!deal) return "";
  return (
    deal.company_name ||
    deal.primary_contact?.name ||
    deal.stage ||
    `Deal ${String(deal._id || "").slice(-6)}`
  );
}

export default function NewQuotation() {
  const navigate = useNavigate();
  const location = useLocation();

  const [deals, setDeals] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [quotedDealIds, setQuotedDealIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [showDealSuggestions, setShowDealSuggestions] = useState(false);

  const [form, setForm] = useState({
    dealId: "",
    quoteDate: todayAsInputDate(),
    validUntil: "",
    discountAmount: 0,
    notes: ""
  });

  const [lineItems, setLineItems] = useState([makeEmptyItem()]);

  useEffect(() => {
    loadDependencies();
  }, []);

  const initialDealId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("dealId") || "";
  }, [location.search]);

  const initialFromQuoteId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("fromQuoteId") || "";
  }, [location.search]);

  const isVersionMode = Boolean(initialFromQuoteId);

  const quotedDealIdSet = useMemo(
    () => new Set((quotedDealIds || []).map((dealId) => String(dealId))),
    [quotedDealIds]
  );

  const eligibleDeals = useMemo(() => {
    return deals.filter((deal) => {
      const dealId = String(deal._id || "");
      const isActive = deal.isActive !== false && deal.is_deleted !== true && deal.deleted !== true;
      if (!isActive) return false;

      if (isVersionMode && String(form.dealId) === dealId) {
        return true;
      }

      return !quotedDealIdSet.has(dealId);
    });
  }, [deals, quotedDealIdSet, isVersionMode, form.dealId]);

  const filteredDealSuggestions = useMemo(() => {
    const searchTerm = String(dealSearch || "").trim().toLowerCase();
    const source = eligibleDeals || [];
    if (!searchTerm) return source.slice(0, 10);

    return source
      .filter((deal) => {
        const dealName = String(getDealDisplayName(deal) || "").toLowerCase();
        const stage = String(deal.stage || "").toLowerCase();
        const contact = String(deal.primary_contact?.name || "").toLowerCase();
        return (
          dealName.includes(searchTerm) ||
          stage.includes(searchTerm) ||
          contact.includes(searchTerm)
        );
      })
      .slice(0, 10);
  }, [eligibleDeals, dealSearch]);

  const selectedDeal = useMemo(
    () => deals.find((deal) => String(deal._id) === String(form.dealId)),
    [deals, form.dealId]
  );

  const productMap = useMemo(
    () => new Map(products.map((product) => [String(product._id), product])),
    [products]
  );

  const taxMap = useMemo(
    () => new Map(taxes.map((tax) => [String(tax._id), tax])),
    [taxes]
  );

  const calculatedItems = useMemo(() => {
    return lineItems.map((item) => {
      const quantity = Math.max(1, Math.round(parseNumber(item.quantity, 1)));
      const unitPrice = Math.max(0, parseNumber(item.unitPrice, 0));
      const discountPercent = Math.min(100, Math.max(0, parseNumber(item.discountPercent, 0)));
      const taxPercent = item.taxId
        ? Math.min(100, Math.max(0, parseNumber(taxMap.get(String(item.taxId))?.rate, 0)))
        : 0;

      const grossSubtotal = quantity * unitPrice;
      const discountValue = grossSubtotal * (discountPercent / 100);
      const taxableSubtotal = grossSubtotal - discountValue;
      const tax = taxableSubtotal * (taxPercent / 100);
      const netTotal = taxableSubtotal + tax;

      return {
        ...item,
        quantity,
        unitPrice: round2(unitPrice),
        discountPercent: round2(discountPercent),
        taxPercent: round2(taxPercent),
        lineSubtotal: round2(taxableSubtotal),
        lineTax: round2(tax),
        netTotal: round2(netTotal)
      };
    });
  }, [lineItems, taxMap]);

  const totals = useMemo(() => {
    const subtotal = calculatedItems.reduce((acc, item) => acc + item.lineSubtotal, 0);
    const tax = calculatedItems.reduce((acc, item) => acc + item.lineTax, 0);
    const discountAmount = Math.max(0, parseNumber(form.discountAmount, 0));
    const grandTotal = Math.max(0, round2(subtotal + tax - discountAmount));

    return {
      subtotal: round2(subtotal),
      tax: round2(tax),
      discountAmount: round2(discountAmount),
      grandTotal
    };
  }, [calculatedItems, form.discountAmount]);

  const loadDependencies = async () => {
    try {
      setLoading(true);
      setError("");

      const [dealsRes, productsRes, taxesRes, quotationsRes] = await Promise.all([
        API.get("/deals"),
        API.get("/products"),
        API.get("/taxes"),
        API.get("/quotations")
      ]);

      const dealRows = dealsRes.data || [];
      const productRows = productsRes.data || [];
      const taxRows = taxesRes.data || [];
      const quotationRows = quotationsRes.data || [];
      const existingDealIds = [
        ...new Set(
          (Array.isArray(quotationRows) ? quotationRows : [])
            .map((quote) => quote?.dealId)
            .filter(Boolean)
            .map((dealId) => String(dealId))
        )
      ];

      setDeals(dealRows);
      setProducts(productRows);
      setTaxes(taxRows);
      setQuotedDealIds(existingDealIds);

      if (
        initialDealId &&
        dealRows.some((deal) => String(deal._id) === initialDealId) &&
        (isVersionMode || !existingDealIds.includes(String(initialDealId)))
      ) {
        setForm((prev) => ({
          ...prev,
          dealId: initialDealId
        }));
        const initialDeal = dealRows.find((deal) => String(deal._id) === String(initialDealId));
        setDealSearch(getDealDisplayName(initialDeal));
      } else if (initialDealId && existingDealIds.includes(String(initialDealId)) && !isVersionMode) {
        setError(
          "This deal already has a quotation. Please use New Version from quotation details."
        );
      }

      // If opening as a new version from an existing quotation, prefill fields
      if (initialFromQuoteId) {
        try {
          const quoteRes = await API.get(`/quotations/${initialFromQuoteId}`);
          const detail = quoteRes.data || null;
          if (detail && detail.quotation) {
            const q = detail.quotation;

            setForm((prev) => ({
              ...prev,
              dealId: q.dealId || prev.dealId || initialDealId,
              quoteDate: q.quoteDate ? q.quoteDate.split("T")[0] : prev.quoteDate,
              validUntil: q.validUntil ? q.validUntil.split("T")[0] : prev.validUntil,
              discountAmount: q.discountAmount || prev.discountAmount,
              notes: q.notes || prev.notes
            }));

            const prefillDeal = dealRows.find((deal) => String(deal._id) === String(q.dealId || ""));
            if (prefillDeal) {
              setDealSearch(getDealDisplayName(prefillDeal));
            }

            if (Array.isArray(detail.items) && detail.items.length) {
              const mapped = detail.items.map((it) => ({
                productId: it.productId || "",
                quantity: it.quantity || 1,
                unitPrice: it.unitPrice || 0,
                discountPercent: it.discountPercent || 0,
                taxId: ""
              }));

              // Try to set taxId from products list when available
              const prodMap = new Map((productRows || []).map((p) => [String(p._id), p]));
              const withTax = mapped.map((mi) => ({
                ...mi,
                taxId: prodMap.get(String(mi.productId))?.taxId || mi.taxId || ""
              }));

              setLineItems(withTax.length ? withTax : [makeEmptyItem()]);
            }
          }
        } catch (err) {
          console.error("Failed to prefill from quotation:", err);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load deals/products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!form.dealId) {
      if (!showDealSuggestions) {
        setDealSearch("");
      }
      return;
    }

    const deal = deals.find((row) => String(row._id) === String(form.dealId));
    if (deal) {
      setDealSearch(getDealDisplayName(deal));
    }
  }, [form.dealId, deals, showDealSuggestions]);

  const updateLineItem = (index, key, value) => {
    setLineItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [key]: value
      };

      if (key === "productId") {
        const selectedProduct = productMap.get(String(value));
        if (selectedProduct) {
          next[index].unitPrice = selectedProduct.price || 0;
          next[index].taxId = selectedProduct.taxId || "";
        }
      }

      return next;
    });
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, makeEmptyItem()]);
  };

  const removeLineItem = (index) => {
    setLineItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const submit = async () => {
    const validItems = calculatedItems.filter((item) => item.productId);

    if (!form.dealId) {
      alert("Please select a deal");
      return;
    }

    if (!validItems.length) {
      alert("Please add at least one line item with a product");
      return;
    }

    try {
      setSaving(true);

      await API.post("/quotations", {
        dealId: form.dealId,
        baseQuotationId: initialFromQuoteId || null,
        quoteDate: form.quoteDate,
        validUntil: form.validUntil || null,
        discountAmount: totals.discountAmount,
        notes: form.notes,
        items: validItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent,
          taxId: item.taxId || null
        }))
      });

      navigate("/quotations");
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to create quotation");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="quotes-empty">Loading quotation form...</div>;
  }

  return (
    <div className="quote-form-page">
      <div className="quote-form-card">
        <div className="quote-form-header">
          <h2>New Quotation</h2>

          <div className="quote-form-header-actions">
            <button
              className="quote-add-deal-btn"
              onClick={() => navigate("/leads/new?view=deal")}
              type="button"
            >
              + Add Deal
            </button>

            <button className="quote-close-btn" onClick={() => navigate("/quotations")}>
              x
            </button>
          </div>
        </div>

        {error && <div className="quote-form-error">{error}</div>}

        <div className="quote-form-grid">
          <div className="quote-field">
            <label>Link To Deal</label>
            <div className="quote-deal-search-wrap">
              <input
                type="text"
                value={dealSearch}
                placeholder="Search active deals by client name..."
                readOnly={isVersionMode}
                onFocus={() => {
                  if (!isVersionMode) setShowDealSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowDealSuggestions(false), 150)}
                onChange={(e) => {
                  if (isVersionMode) return;
                  const value = e.target.value;
                  setDealSearch(value);
                  setForm((prev) => ({ ...prev, dealId: "" }));
                  setShowDealSuggestions(true);
                }}
              />

              {!isVersionMode && showDealSuggestions && (
                <ul className="quote-deal-suggestions">
                  {filteredDealSuggestions.length === 0 ? (
                    <li className="quote-deal-suggestion-empty">
                      {eligibleDeals.length === 0
                        ? "No eligible active deals. For existing quotes, use New Version."
                        : "No matching deals found"}
                    </li>
                  ) : (
                    filteredDealSuggestions.map((deal) => (
                      <li
                        key={deal._id}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setForm((prev) => ({
                            ...prev,
                            dealId: String(deal._id)
                          }));
                          setDealSearch(getDealDisplayName(deal));
                          setShowDealSuggestions(false);
                        }}
                      >
                        <span className="quote-deal-suggestion-title">
                          {getDealDisplayName(deal)}
                        </span>
                        <span className="quote-deal-suggestion-meta">
                          {deal.stage || "No stage"} | {String(deal._id).slice(-6)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </div>

          <div className="quote-field">
            <label>Client Name</label>
            <input
              value={
                selectedDeal?.company_name ||
                selectedDeal?.primary_contact?.name ||
                ""
              }
              readOnly
              placeholder="Auto-filled from selected deal"
            />
          </div>

          <div className="quote-field">
            <label>Quote Date</label>
            <input
              type="date"
              value={form.quoteDate}
              onChange={(e) => setForm({ ...form, quoteDate: e.target.value })}
            />
          </div>

          <div className="quote-field">
            <label>Valid Until</label>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </div>
        </div>

        <div className="quote-line-items-card">
          <div className="quote-line-items-header">
            <h3>Line Items</h3>
            <button className="quote-add-product-btn" onClick={addLineItem}>
              + Add Product
            </button>
          </div>

          <div className="quote-line-table">
            <div className="quote-line-head">Product</div>
            <div className="quote-line-head">Qty</div>
            <div className="quote-line-head">Unit</div>
            <div className="quote-line-head">Disc%</div>
            <div className="quote-line-head">Tax</div>
            <div className="quote-line-head">Net Total</div>
            <div className="quote-line-head"> </div>

            {calculatedItems.map((item, index) => (
              <LineItemRow
                key={`${index}-${item.productId}`}
                item={item}
                products={products}
                taxes={taxes}
                onChange={(key, value) => updateLineItem(index, key, value)}
                onRemove={() => removeLineItem(index)}
                canRemove={calculatedItems.length > 1}
              />
            ))}
          </div>
        </div>

        <div className="quote-summary-card">
          <div className="quote-summary-row">
            <span>Subtotal</span>
            <span>{formatCurrency(totals.subtotal)}</span>
          </div>

          <div className="quote-summary-row">
            <span>Tax</span>
            <span>{formatCurrency(totals.tax)}</span>
          </div>

          <div className="quote-summary-row quote-summary-discount">
            <span>Discount (INR)</span>
            <input
              type="number"
              min="0"
              value={form.discountAmount}
              onChange={(e) => setForm({ ...form, discountAmount: e.target.value })}
            />
          </div>

          <div className="quote-summary-total">
            <span>Grand Total</span>
            <strong>{formatCurrency(totals.grandTotal)}</strong>
          </div>
        </div>

        <div className="quote-field quote-field-full quote-notes-field">
          <label>Notes</label>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="quote-form-footer">
          <button className="quote-cancel-btn" onClick={() => navigate("/quotations")}>
            Cancel
          </button>

          <button className="quote-submit-btn" disabled={saving} onClick={submit}>
            {saving ? "Creating..." : "Create Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineItemRow({ item, products, taxes, onChange, onRemove, canRemove }) {
  return (
    <>
      <select value={item.productId} onChange={(e) => onChange("productId", e.target.value)}>
        <option value="">Select Product</option>
        {products.map((product) => (
          <option key={product._id} value={product._id}>
            {product.name}
          </option>
        ))}
      </select>

      <input
        type="number"
        min="1"
        value={item.quantity}
        onChange={(e) => onChange("quantity", e.target.value)}
      />

      <input
        type="number"
        min="0"
        value={item.unitPrice}
        onChange={(e) => onChange("unitPrice", e.target.value)}
      />

      <input
        type="number"
        min="0"
        max="100"
        value={item.discountPercent}
        onChange={(e) => onChange("discountPercent", e.target.value)}
      />

      <select value={item.taxId || ""} onChange={(e) => onChange("taxId", e.target.value)}>
        <option value="">0%</option>
        {taxes.map((tax) => (
          <option key={tax._id} value={tax._id}>
            {tax.rate}%
          </option>
        ))}
      </select>

      <div className="quote-line-net">{formatCurrency(item.netTotal)}</div>

      <button className="quote-remove-row-btn" disabled={!canRemove} onClick={onRemove}>
        x
      </button>
    </>
  );
}
