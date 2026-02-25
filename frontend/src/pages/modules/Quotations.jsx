import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Quotations.css";

const STATUS_CLASS = {
  draft: "draft",
  sent: "sent",
  viewed: "viewed",
  negotiation: "negotiation",
  approved: "approved",
  rejected: "rejected",
  expired: "expired"
};

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

export default function Quotations() {

  const navigate = useNavigate();

  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadQuotations();
  }, []);

  const loadQuotations = async () => {

    try {

      setLoading(true);
      setError("");

      const res = await API.get("/quotations");
      setQuotations(res.data || []);

    } catch (err) {

      console.error(err);
      setError("Failed to load quotations");

    } finally {

      setLoading(false);

    }

  };

  const removeQuotation = async (quotationId) => {

    const shouldDelete = window.confirm("Delete this quotation?");
    if (!shouldDelete) return;

    try {

      await API.put(`/quotations/delete/${quotationId}`);
      await loadQuotations();

    } catch (err) {

      console.error(err);
      alert("Failed to delete quotation");

    }

  };

  return (

    <div className="quotes-page">

      <div className="quotes-toolbar">

        <button
          className="quotes-new-btn"
          onClick={() => navigate("/quotations/new")}
        >
          + New Quote
        </button>

      </div>

      <div className="quotes-table-shell">

        {loading ? (
          <div className="quotes-empty">Loading quotations...</div>
        ) : error ? (
          <div className="quotes-empty">{error}</div>
        ) : quotations.length === 0 ? (
          <div className="quotes-empty">
            No quotations yet. Create your first quote.
          </div>
        ) : (
          <div className="quotes-table-scroll">

            <table className="quotes-table">

              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Ref</th>
                  <th>Client</th>
                  <th>Items</th>
                  <th>Subtotal</th>
                  <th>Tax</th>
                  <th>Disc.</th>
                  <th>Grand Total</th>
                  <th>Valid Until</th>
                  <th>Status</th>
                  <th>Ver.</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {quotations.map((quote) => (
                  <tr key={quote._id}>

                    <td className="quote-number">
                      {quote.quoteNumber}
                    </td>

                    <td>
                      {quote.refCode}
                    </td>

                    <td>
                      {quote.clientName}
                    </td>

                    <td>
                      {quote.itemsCount} item{quote.itemsCount === 1 ? "" : "s"}
                    </td>

                    <td>{formatCurrency(quote.subtotalAmount)}</td>
                    <td>{formatCurrency(quote.taxAmount)}</td>
                    <td>{formatCurrency(quote.discountAmount)}</td>

                    <td className="quote-grand-total">
                      {formatCurrency(quote.grandTotal)}
                    </td>

                    <td>{formatDate(quote.validUntil)}</td>

                    <td>
                      <span className={`quote-status ${STATUS_CLASS[quote.status] || "draft"}`}>
                        {quote.status}
                      </span>
                    </td>

                    <td>
                      v{quote.version}
                    </td>

                    <td>
                      <div className="quote-actions">

                        <button
                          className="quote-action-btn quote-action-neutral"
                          onClick={() => navigate(`/quotations/new?dealId=${quote.dealId}`)}
                        >
                          New Version
                        </button>

                        <button
                          className="quote-action-btn quote-action-danger"
                          onClick={() => removeQuotation(quote._id)}
                        >
                          Delete
                        </button>

                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>

            </table>

          </div>
        )}

      </div>

    </div>

  );

}
