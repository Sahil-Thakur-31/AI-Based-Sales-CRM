import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import "./styles/Quotations.css";
const VERSION_ALLOWED_PREVIOUS_STATUSES = ["expired", "rejected"];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export default function QuotationDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const loadDetails = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await API.get(`/quotations/${id}`);
      setDetail(res.data || null);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Failed to load quotation details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  }, [id]);

  const totals = useMemo(() => {
    if (!detail?.quotation) return null;
    return {
      subtotalAmount: detail.quotation.subtotalAmount || 0,
      taxAmount: detail.quotation.taxAmount || 0,
      discountAmount: detail.quotation.discountAmount || 0,
      grandTotal: detail.quotation.grandTotal || 0
    };
  }, [detail]);

  const canCreateNewVersion = VERSION_ALLOWED_PREVIOUS_STATUSES.includes(
    String(detail?.quotation?.status || "").toLowerCase()
  );

  if (loading) {
    return <div className="quotes-empty">Loading quotation details...</div>;
  }

  if (error) {
    return <div className="quotes-empty">{error}</div>;
  }

  if (!detail) {
    return <div className="quotes-empty">No quotation data found.</div>;
  }

  return (
    <div className="quote-detail-page">
      <div className="quote-detail-topbar">
        <button className="quote-cancel-btn" onClick={() => navigate("/quotations")}>
          Back
        </button>

        <button
          className="quote-submit-btn"
          disabled={!canCreateNewVersion}
          title={
            canCreateNewVersion
              ? "Create a new quotation version"
              : "New version is allowed only when latest quotation is expired or rejected"
          }
          onClick={() => {
            if (!canCreateNewVersion) return;
            navigate(
              `/quotations/new?dealId=${detail?.quotation?.dealId || ""}&fromQuoteId=${detail?.quotation?._id || ""}`
            );
          }}
        >
          New Version
        </button>
      </div>

      <div className="quote-form-card">
        <div className="quote-form-header">
          <h2>Quotation Details</h2>
        </div>

        <div className="quote-detail-grid">
          <div className="quote-detail-item">
            <span>Quote #</span>
            <strong>{detail.quotation.quoteNumber}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Version</span>
            <strong>v{detail.quotation.version}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Status</span>
            <strong className="quote-detail-cap">{detail.quotation.status}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Quote Date</span>
            <strong>{formatDate(detail.quotation.quoteDate)}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Valid Until</span>
            <strong>{formatDate(detail.quotation.validUntil)}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Deal Ref</span>
            <strong>{detail.deal?.stage || "-"}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Client</span>
            <strong>{detail.client?.name || "-"}</strong>
          </div>
          <div className="quote-detail-item">
            <span>Currency</span>
            <strong>{detail.quotation.currency || "INR"}</strong>
          </div>
        </div>

        <div className="quote-detail-section">
          <h3>Line Items</h3>
          {!detail.items?.length ? (
            <div className="quotes-empty">No line items found.</div>
          ) : (
            <div className="quotes-table-scroll">
              <table className="quotes-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Disc%</th>
                    <th>Tax%</th>
                    <th>Subtotal</th>
                    <th>Tax</th>
                    <th>Net Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item._id}>
                      <td>{item.productName}</td>
                      <td>{item.category || "-"}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unitPrice)}</td>
                      <td>{item.discountPercent}%</td>
                      <td>{item.taxRate}%</td>
                      <td>{formatCurrency(item.subtotal)}</td>
                      <td>{formatCurrency(item.tax)}</td>
                      <td className="quote-grand-total">{formatCurrency(item.netTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {detail.quotation.notes ? (
          <div className="quote-detail-section">
            <h3>Notes</h3>
            <p className="quote-detail-notes">{detail.quotation.notes}</p>
          </div>
        ) : null}

        {totals ? (
          <div className="quote-summary-card">
            <div className="quote-summary-row">
              <span>Subtotal</span>
              <span>{formatCurrency(totals.subtotalAmount)}</span>
            </div>
            <div className="quote-summary-row">
              <span>Tax</span>
              <span>{formatCurrency(totals.taxAmount)}</span>
            </div>
            <div className="quote-summary-row">
              <span>Discount</span>
              <span>{formatCurrency(totals.discountAmount)}</span>
            </div>
            <div className="quote-summary-total">
              <span>Grand Total</span>
              <strong>{formatCurrency(totals.grandTotal)}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
