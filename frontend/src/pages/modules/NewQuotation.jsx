import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
import { getStageTitle } from "../../utils/stages";
import LeadFormPage from "./LeadFormPage";
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

function getLeadDisplayName(lead) {
  if (!lead) return "";
  return (
    lead.company_name ||
    lead.primary_contact?.name ||
    lead.stage ||
    `Lead ${String(lead._id || "").slice(-6)}`
  );
}

export default function NewQuotation() {
  const navigate = useNavigate();
  const location = useLocation();
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const isAdmin = roleName === "admin";

  const [quoteType, setQuoteType] = useState("deal");
  const [deals, setDeals] = useState([]);
  const [leads, setLeads] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [quotedDealIds, setQuotedDealIds] = useState([]);
  const [quotedLeadIds, setQuotedLeadIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [showDealSuggestions, setShowDealSuggestions] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [showLeadSuggestions, setShowLeadSuggestions] = useState(false);
  const [hasExistingSource, setHasExistingSource] = useState("yes");
  const [showSourceCreateModal, setShowSourceCreateModal] = useState(false);

  const [form, setForm] = useState({
    dealId: "",
    leadId: "",
    quoteDate: todayAsInputDate(),
    validUntil: "",
    discountAmount: 0,
    notes: ""
  });

  const [lineItems, setLineItems] = useState([makeEmptyItem()]);

  useEffect(() => {
    if (isAdmin) {
      navigate("/quotations");
      return;
    }
    loadDependencies();
  }, [isAdmin, navigate]);

  const initialDealId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("dealId") || "";
  }, [location.search]);

  const initialLeadId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("leadId") || "";
  }, [location.search]);

  const initialQuoteType = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = String(params.get("type") || "").toLowerCase();
    return raw === "lead" ? "lead" : "deal";
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

  const quotedLeadIdSet = useMemo(
    () => new Set((quotedLeadIds || []).map((leadId) => String(leadId))),
    [quotedLeadIds]
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

  const eligibleLeads = useMemo(() => {
    return leads.filter((lead) => {
      const leadId = String(lead._id || "");
      const isActive = lead.is_active !== false && lead.is_deleted !== true && lead.deleted !== true;
      if (!isActive) return false;

      if (isVersionMode && String(form.leadId) === leadId) {
        return true;
      }

      return !quotedLeadIdSet.has(leadId);
    });
  }, [leads, quotedLeadIdSet, isVersionMode, form.leadId]);

  const filteredLeadSuggestions = useMemo(() => {
    const searchTerm = String(leadSearch || "").trim().toLowerCase();
    const source = eligibleLeads || [];
    if (!searchTerm) return source.slice(0, 10);

    return source
      .filter((lead) => {
        const leadName = String(getLeadDisplayName(lead) || "").toLowerCase();
        const stage = String(lead.stage || "").toLowerCase();
        return leadName.includes(searchTerm) || stage.includes(searchTerm);
      })
      .slice(0, 10);
  }, [eligibleLeads, leadSearch]);

  const selectedDeal = useMemo(
    () => deals.find((deal) => String(deal._id) === String(form.dealId)),
    [deals, form.dealId]
  );

  const selectedLead = useMemo(
    () => leads.find((lead) => String(lead._id) === String(form.leadId)),
    [leads, form.leadId]
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

      const [dealsRes, leadsRes, productsRes, taxesRes, quotationsRes] = await Promise.all([
        API.get("/deals"),
        API.get("/leads"),
        API.get("/products"),
        API.get("/taxes"),
        API.get("/quotations")
      ]);

      const dealRows = dealsRes.data || [];
      const leadRows = leadsRes.data || [];
      const productRows = productsRes.data || [];
      const taxRows = taxesRes.data || [];
      const quotationRows = quotationsRes.data || [];
      const existingDealIds = [
        ...new Set(
          (Array.isArray(quotationRows) ? quotationRows : [])
            .filter((quote) => String(quote?.quoteType || "deal") !== "lead")
            .map((quote) => quote?.dealId)
            .filter(Boolean)
            .map((dealId) => String(dealId))
        )
      ];
      const existingLeadIds = [
        ...new Set(
          (Array.isArray(quotationRows) ? quotationRows : [])
            .filter((quote) => String(quote?.quoteType || "deal") === "lead")
            .map((quote) => quote?.leadId)
            .filter(Boolean)
            .map((leadId) => String(leadId))
        )
      ];

      setDeals(dealRows);
      setLeads(leadRows);
      setProducts(productRows);
      setTaxes(taxRows);
      setQuotedDealIds(existingDealIds);
      setQuotedLeadIds(existingLeadIds);

      if (!isVersionMode) {
        if (!initialDealId && !initialLeadId) {
          setQuoteType(initialQuoteType);
        }
        if (
          initialLeadId &&
          leadRows.some((lead) => String(lead._id) === String(initialLeadId)) &&
          !existingLeadIds.includes(String(initialLeadId))
        ) {
          setQuoteType("lead");
          setForm((prev) => ({
            ...prev,
            leadId: initialLeadId,
            dealId: ""
          }));
          const initialLead = leadRows.find((lead) => String(lead._id) === String(initialLeadId));
          setLeadSearch(getLeadDisplayName(initialLead));
        } else if (initialLeadId && existingLeadIds.includes(String(initialLeadId))) {
          setError(
            "This lead already has a quotation. Please use New Version from quotation details."
          );
        } else if (
          initialDealId &&
          dealRows.some((deal) => String(deal._id) === initialDealId) &&
          !existingDealIds.includes(String(initialDealId))
        ) {
          setQuoteType("deal");
          setForm((prev) => ({
            ...prev,
            dealId: initialDealId,
            leadId: ""
          }));
          const initialDeal = dealRows.find((deal) => String(deal._id) === String(initialDealId));
          setDealSearch(getDealDisplayName(initialDeal));
        } else if (initialDealId && existingDealIds.includes(String(initialDealId))) {
          setError(
            "This deal already has a quotation. Please use New Version from quotation details."
          );
        }
      }

      // If opening as a new version from an existing quotation, prefill fields
      if (initialFromQuoteId) {
        try {
          const quoteRes = await API.get(`/quotations/${initialFromQuoteId}`);
          const detail = quoteRes.data || null;
          if (detail && detail.quotation) {
            const q = detail.quotation;
            const nextQuoteType = String(q.quoteType || (q.leadId ? "lead" : "deal"));
            setQuoteType(nextQuoteType === "lead" ? "lead" : "deal");
            setHasExistingSource("yes");

            setForm((prev) => ({
              ...prev,
              dealId: q.dealId || prev.dealId || initialDealId,
              leadId: q.leadId || prev.leadId || initialLeadId,
              quoteDate: q.quoteDate ? q.quoteDate.split("T")[0] : prev.quoteDate,
              validUntil: q.validUntil ? q.validUntil.split("T")[0] : prev.validUntil,
              discountAmount: q.discountAmount || prev.discountAmount,
              notes: q.notes || prev.notes
            }));

            if (nextQuoteType === "lead") {
              const prefillLead = leadRows.find((lead) => String(lead._id) === String(q.leadId || ""));
              if (prefillLead) {
                setLeadSearch(getLeadDisplayName(prefillLead));
              }
            } else {
              const prefillDeal = dealRows.find((deal) => String(deal._id) === String(q.dealId || ""));
              if (prefillDeal) {
                setDealSearch(getDealDisplayName(prefillDeal));
              }
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

  useEffect(() => {
    if (!form.leadId) {
      if (!showLeadSuggestions) {
        setLeadSearch("");
      }
      return;
    }

    const lead = leads.find((row) => String(row._id) === String(form.leadId));
    if (lead) {
      setLeadSearch(getLeadDisplayName(lead));
    }
  }, [form.leadId, leads, showLeadSuggestions]);

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

  const handleSourceCreated = (data) => {
    if (quoteType === "deal") {
      const createdLead = data?.lead || null;
      const createdDeal = data?.deal || null;

      if (createdLead?._id) {
        setLeads((prev) => {
          const id = String(createdLead._id);
          const withoutDup = prev.filter((row) => String(row._id) !== id);
          return [createdLead, ...withoutDup];
        });
      }

      if (!createdDeal?._id) return;

      setDeals((prev) => {
        const id = String(createdDeal._id);
        const withoutDup = prev.filter((row) => String(row._id) !== id);
        return [createdDeal, ...withoutDup];
      });

      setForm((prev) => ({
        ...prev,
        dealId: String(createdDeal._id),
        leadId: ""
      }));
      setDealSearch(getDealDisplayName(createdDeal));
      setLeadSearch("");
      setHasExistingSource("yes");
      setShowSourceCreateModal(false);
      return;
    }

    const createdLead = data?.lead || data || null;
    if (!createdLead?._id) return;

    setLeads((prev) => {
      const id = String(createdLead._id);
      const withoutDup = prev.filter((row) => String(row._id) !== id);
      return [createdLead, ...withoutDup];
    });

    setForm((prev) => ({
      ...prev,
      leadId: String(createdLead._id),
      dealId: ""
    }));
    setLeadSearch(getLeadDisplayName(createdLead));
    setDealSearch("");
    setHasExistingSource("yes");
    setShowSourceCreateModal(false);
  };

  const submit = async () => {
    setError("");
    const validItems = calculatedItems.filter((item) => item.productId);
    const validationChecks = [
      quoteType === "deal" && !form.dealId ? "Please select a deal" : "",
      quoteType === "lead" && !form.leadId ? "Please select a lead" : "",
      !String(form.quoteDate || "").trim() ? "Quote date is required" : "",
      form.validUntil && form.quoteDate && form.validUntil < form.quoteDate
        ? "Valid until date cannot be before quote date"
        : "",
      !validItems.length ? "Please add at least one line item with a product" : "",
      validItems.some((item) => Number(item.quantity || 0) < 1)
        ? "Line item quantity must be at least 1"
        : "",
      validItems.some((item) => Number(item.unitPrice || 0) < 0)
        ? "Line item unit price cannot be negative"
        : "",
    ];
    const firstError = validationChecks.find(Boolean) || "";
    if (firstError) {
      setError(firstError);
      return;
    }

    try {
      setSaving(true);

      await API.post("/quotations", {
        quoteType,
        dealId: quoteType === "deal" ? form.dealId : null,
        leadId: quoteType === "lead" ? form.leadId : null,
        clientId: null,
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
      setError(err.response?.data?.message || "Failed to create quotation");
    } finally {
      setSaving(false);
    }
  };

  const onQuoteTypeChange = (nextType) => {
    if (isVersionMode) return;
    setQuoteType(nextType);
    setHasExistingSource("yes");
    setShowDealSuggestions(false);
    setShowLeadSuggestions(false);
    setShowSourceCreateModal(false);
    setDealSearch("");
    setLeadSearch("");
    setForm((prev) => ({
      ...prev,
      dealId: "",
      leadId: ""
    }));
  };

  const onExistingSourceChange = (value) => {
    if (isVersionMode) return;
    setHasExistingSource(value);
    setShowDealSuggestions(false);
    setShowLeadSuggestions(false);

    if (value === "no") {
      setDealSearch("");
      setLeadSearch("");
      setForm((prev) => ({
        ...prev,
        dealId: "",
        leadId: ""
      }));
    }
  };

  const sourceLabel = quoteType === "deal" ? "Deal" : "Lead";
  const sourceSearch = quoteType === "deal" ? dealSearch : leadSearch;
  const showSourceSuggestions = quoteType === "deal" ? showDealSuggestions : showLeadSuggestions;
  const filteredSourceSuggestions =
    quoteType === "deal" ? filteredDealSuggestions : filteredLeadSuggestions;
  const eligibleSourceCount = quoteType === "deal" ? eligibleDeals.length : eligibleLeads.length;
  const selectedSource = quoteType === "deal" ? selectedDeal : selectedLead;
  const selectedSourceName = selectedSource
    ? quoteType === "deal"
      ? getDealDisplayName(selectedSource)
      : getLeadDisplayName(selectedSource)
    : "";

  const setShowSourceSuggestions = (value) => {
    if (quoteType === "deal") {
      setShowDealSuggestions(value);
      return;
    }
    setShowLeadSuggestions(value);
  };

  const handleSourceSearchChange = (value) => {
    if (quoteType === "deal") {
      setDealSearch(value);
      setForm((prev) => ({ ...prev, dealId: "" }));
      setShowDealSuggestions(true);
      return;
    }

    setLeadSearch(value);
    setForm((prev) => ({ ...prev, leadId: "" }));
    setShowLeadSuggestions(true);
  };

  const handleSourceSelect = (source) => {
    if (quoteType === "deal") {
      setForm((prev) => ({
        ...prev,
        dealId: String(source._id),
        leadId: ""
      }));
      setDealSearch(getDealDisplayName(source));
      setShowDealSuggestions(false);
      return;
    }

    setForm((prev) => ({
      ...prev,
      leadId: String(source._id),
      dealId: ""
    }));
    setLeadSearch(getLeadDisplayName(source));
    setShowLeadSuggestions(false);
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
            <button className="quote-close-btn" onClick={() => navigate("/quotations")}>
              x
            </button>
          </div>
        </div>

        <div className="quote-type-tabs">
          <button
            type="button"
            className={`quote-type-tab ${quoteType === "deal" ? "active" : ""}`}
            onClick={() => onQuoteTypeChange("deal")}
            disabled={isVersionMode}
          >
            Deal Quotation
          </button>
          <button
            type="button"
            className={`quote-type-tab ${quoteType === "lead" ? "active" : ""}`}
            onClick={() => onQuoteTypeChange("lead")}
            disabled={isVersionMode}
          >
            Lead Quotation
          </button>
        </div>

        <div className="quote-form-grid">
          <div className="quote-field quote-field-full quote-lead-client-switch">
            <label>Is {sourceLabel} Existing?</label>
            <div className="quote-inline-create-row">
              <div className="quote-radio-row">
                <label>
                  <input
                    type="radio"
                    name="existingSource"
                    checked={hasExistingSource === "yes"}
                    disabled={isVersionMode}
                    onChange={() => onExistingSourceChange("yes")}
                  />
                  <span>Yes</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="existingSource"
                    checked={hasExistingSource === "no"}
                    disabled={isVersionMode}
                    onChange={() => onExistingSourceChange("no")}
                  />
                  <span>No</span>
                </label>
              </div>

              {!isVersionMode && hasExistingSource === "no" && (
                <button
                  type="button"
                  className="quote-add-product-btn"
                  onClick={() => setShowSourceCreateModal(true)}
                >
                  + Add New {sourceLabel}
                </button>
              )}
            </div>
          </div>

          {(hasExistingSource === "yes" || isVersionMode) && (
            <>
              <div className="quote-field">
                <label>Link To {sourceLabel}</label>
                <div className="quote-deal-search-wrap">
                  <input
                    type="text"
                    value={sourceSearch}
                    placeholder={`Search active ${quoteType === "deal" ? "deals" : "leads"}...`}
                    readOnly={isVersionMode}
                    onFocus={() => {
                      if (!isVersionMode) setShowSourceSuggestions(true);
                    }}
                    onBlur={() => setTimeout(() => setShowSourceSuggestions(false), 150)}
                    onChange={(e) => {
                      if (isVersionMode) return;
                      handleSourceSearchChange(e.target.value);
                    }}
                  />

                  {!isVersionMode && showSourceSuggestions && (
                    <ul className="quote-deal-suggestions">
                      {filteredSourceSuggestions.length === 0 ? (
                        <li className="quote-deal-suggestion-empty">
                          {eligibleSourceCount === 0
                            ? `No eligible active ${quoteType === "deal" ? "deals" : "leads"}. For existing quotes, use New Version.`
                            : `No matching ${quoteType === "deal" ? "deals" : "leads"} found`}
                        </li>
                      ) : (
                        filteredSourceSuggestions.map((source) => (
                          <li
                            key={source._id}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSourceSelect(source);
                            }}
                          >
                            <span className="quote-deal-suggestion-title">
                              {quoteType === "deal"
                                ? getDealDisplayName(source)
                                : getLeadDisplayName(source)}
                            </span>
                            <span className="quote-deal-suggestion-meta">
                              {source.stage
                                ? getStageTitle(source.stage, { bucket: quoteType === "deal" ? "deal" : "lead" })
                                : "No stage"}{" "}
                              | {String(source._id).slice(-6)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              </div>

              <div className="quote-field">
                <label>{sourceLabel} Name</label>
                <input
                  value={selectedSourceName}
                  readOnly
                  placeholder={`Auto-filled from selected ${sourceLabel.toLowerCase()}`}
                />
              </div>
            </>
          )}

          {!isVersionMode && hasExistingSource === "no" && (
            <div className="quote-field quote-field-full">
              <label>Selected {sourceLabel}</label>
              <input
                value={
                  selectedSource
                    ? quoteType === "deal"
                      ? getDealDisplayName(selectedSource)
                      : getLeadDisplayName(selectedSource)
                    : ""
                }
                readOnly
                placeholder={`Use "+ Add New ${sourceLabel}" to create and auto-select ${sourceLabel.toLowerCase()}`}
              />
            </div>
          )}

          <div className="quote-field">
            <label>Quote Date</label>
            <input
              type="date"
              value={form.quoteDate}
              onChange={(e) => setForm((prev) => ({ ...prev, quoteDate: e.target.value }))}
            />
          </div>

          <div className="quote-field">
            <label>Valid Until</label>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm((prev) => ({ ...prev, validUntil: e.target.value }))}
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

        <FormErrorSlot message={error} className="form-error-slot-global quote-form-error-slot" />
        <div className="quote-form-footer">
          <button className="quote-cancel-btn" onClick={() => navigate("/quotations")}>
            Cancel
          </button>

          <button className="quote-submit-btn" disabled={saving} onClick={submit}>
            {saving ? "Creating..." : "Create Quote"}
          </button>
        </div>
      </div>

      {showSourceCreateModal && (
        <div className="quote-inline-modal-overlay" onClick={() => setShowSourceCreateModal(false)}>
          <div className="quote-inline-modal" onClick={(event) => event.stopPropagation()}>
            <div className="quote-inline-modal-head">
              <h3>Add New {sourceLabel}</h3>
              <button
                type="button"
                className="quote-close-btn"
                onClick={() => setShowSourceCreateModal(false)}
              >
                x
              </button>
            </div>
            <div className="quote-inline-modal-body">
              <LeadFormPage
                embedded
                forcedView={quoteType}
                onCancel={() => setShowSourceCreateModal(false)}
                onSaved={handleSourceCreated}
              />
            </div>
          </div>
        </div>
      )}
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
