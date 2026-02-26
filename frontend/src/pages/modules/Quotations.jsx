import { useEffect, useMemo, useState } from "react";
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

const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "negotiation",
  "approved",
  "rejected",
  "expired"
];
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

function matchesQuote(quote, term) {
  if (!term) return true;
  return (
    String(quote.quoteNumber || "").toLowerCase().includes(term) ||
    String(quote.refCode || "").toLowerCase().includes(term) ||
    String(quote.clientName || "").toLowerCase().includes(term) ||
    String(quote.status || "").toLowerCase().includes(term) ||
    `v${quote.version || ""}`.toLowerCase().includes(term)
  );
}

export default function Quotations() {
  const navigate = useNavigate();

  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusUpdatingId, setStatusUpdatingId] = useState("");
  const [expandedDeals, setExpandedDeals] = useState({});

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

  const groupedDeals = useMemo(() => {
    const groups = new Map();

    for (const quote of quotations) {
      const key = String(quote.dealId || "unlinked");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(quote);
    }

    const list = Array.from(groups.entries()).map(([dealId, quotes]) => {
      const sortedQuotes = [...quotes].sort((a, b) => {
        const versionDiff = (b.version || 0) - (a.version || 0);
        if (versionDiff !== 0) return versionDiff;
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
      });

      return {
        dealId,
        latest: sortedQuotes[0],
        previous: sortedQuotes.slice(1),
        all: sortedQuotes
      };
    });

    return list.sort((a, b) => {
      const dateA = new Date(a.latest?.createdAt || 0).getTime();
      const dateB = new Date(b.latest?.createdAt || 0).getTime();
      return dateB - dateA;
    });
  }, [quotations]);

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return groupedDeals;
    return groupedDeals.filter((group) => group.all.some((quote) => matchesQuote(quote, term)));
  }, [groupedDeals, query]);

  const toggleDeal = (dealId) => {
    setExpandedDeals((prev) => ({
      ...prev,
      [dealId]: !prev[dealId]
    }));
  };

  const updateQuotationStatus = async (quotationId, nextStatus, currentStatus) => {
    if (!quotationId || !nextStatus || nextStatus === currentStatus) return;

    try {
      setStatusUpdatingId(quotationId);

      const res = await API.put(`/quotations/${quotationId}/status`, {
        status: nextStatus
      });

      const updatedStatus = res.data?.status || nextStatus;

      setQuotations((prev) =>
        prev.map((quote) =>
          quote._id === quotationId ? { ...quote, status: updatedStatus } : quote
        )
      );
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || "Failed to update quotation status");
    } finally {
      setStatusUpdatingId("");
    }
  };

  return (
    <div className="quotes-page">
      <div className="quotes-toolbar">
        <button className="quotes-new-btn" onClick={() => navigate("/quotations/new")}>
          + New Quote
        </button>

        <input
          className="app-search-input quotes-search-input"
          type="text"
          placeholder="Search quotations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="quotes-table-shell">
        {loading ? (
          <div className="quotes-empty">Loading quotations...</div>
        ) : error ? (
          <div className="quotes-empty">{error}</div>
        ) : groupedDeals.length === 0 ? (
          <div className="quotes-empty">No quotations yet. Create your first quote.</div>
        ) : filteredGroups.length === 0 ? (
          <div className="quotes-empty">No quotations match your search.</div>
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
                {filteredGroups.map((group) => {
                  const expanded = Boolean(expandedDeals[group.dealId]);
                  const latest = group.latest;
                  const canCreateNewVersion = VERSION_ALLOWED_PREVIOUS_STATUSES.includes(
                    String(latest.status || "").toLowerCase()
                  );

                  return (
                    <FragmentRows
                      key={group.dealId}
                      latestRow={
                        <tr
                          className="quote-latest-row quote-latest-row-clickable"
                          onClick={() => toggleDeal(group.dealId)}
                        >
                          <td className="quote-number">{latest.quoteNumber}</td>
                          <td>{latest.refCode}</td>
                          <td>{latest.clientName}</td>
                          <td>
                            {latest.itemsCount} item{latest.itemsCount === 1 ? "" : "s"}
                          </td>
                          <td>{formatCurrency(latest.subtotalAmount)}</td>
                          <td>{formatCurrency(latest.taxAmount)}</td>
                          <td>{formatCurrency(latest.discountAmount)}</td>
                          <td className="quote-grand-total">{formatCurrency(latest.grandTotal)}</td>
                          <td>{formatDate(latest.validUntil)}</td>
                          <td>
                            <select
                              className={`quote-status-select ${STATUS_CLASS[latest.status] || "draft"}`}
                              value={latest.status || "draft"}
                              disabled={statusUpdatingId === latest._id}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateQuotationStatus(latest._id, e.target.value, latest.status)
                              }
                            >
                              {String(latest.status || "").toLowerCase() === "expired" ? (
                                <option value="expired" disabled>
                                  expired
                                </option>
                              ) : null}

                              {QUOTATION_STATUSES.filter((s) => s !== "expired").map((statusOption) => (
                                <option key={statusOption} value={statusOption}>
                                  {statusOption}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>v{latest.version}</td>
                          <td>
                            <div className="quote-actions" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="quote-action-btn quote-action-view"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/quotations/${latest._id}`);
                                }}
                              >
                                View
                              </button>

                              <button
                                className="quote-action-btn quote-action-neutral"
                                disabled={!canCreateNewVersion}
                                title={
                                  canCreateNewVersion
                                    ? "Create a new quotation version"
                                    : "New version is allowed only when latest quotation is expired or rejected"
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!canCreateNewVersion) return;
                                  navigate(`/quotations/new?dealId=${latest.dealId}&fromQuoteId=${latest._id}`);
                                }}
                              >
                                New Version
                              </button>

                            </div>
                          </td>
                        </tr>
                      }
                      historyRows={
                        expanded ? (
                          <tr className="quote-accordion-panel-row">
                            <td colSpan={12}>
                              <div className="quote-accordion-panel">
                                {group.previous.length === 0 ? (
                                  <div className="quote-history-empty">No previous quotations</div>
                                ) : (
                                  group.previous.map((quote) => (
                                    <div key={quote._id} className="quote-history-card">
                                      <div className="quote-history-inline">
                                        <span className="quote-history-badge">Previous</span>
                                        <strong>
                                          {quote.quoteNumber} | v{quote.version}
                                        </strong>
                                        <span>Ref: {quote.refCode}</span>
                                        <span>Items: {quote.itemsCount}</span>
                                        <span>Valid: {formatDate(quote.validUntil)}</span>
                                        <span>Total: {formatCurrency(quote.grandTotal)}</span>
                                      </div>

                                      <div className="quote-history-actions">
                                        <span
                                          className={`quote-status-pill ${STATUS_CLASS[quote.status] || "draft"}`}
                                        >
                                          {quote.status || "draft"}
                                        </span>

                                        <button
                                          className="quote-action-btn quote-action-view"
                                          onClick={() => navigate(`/quotations/${quote._id}`)}
                                        >
                                          View
                                        </button>

                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRows({ latestRow, historyRows }) {
  return (
    <>
      {latestRow}
      {historyRows}
    </>
  );
}
