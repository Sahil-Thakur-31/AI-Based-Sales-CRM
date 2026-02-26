<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Deals.css";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export default function Deals() {
  const navigate = useNavigate();

  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await API.get("/deals");
      setDeals(res.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load deals");
    } finally {
      setLoading(false);
    }
  };

  const filteredDeals = useMemo(() => {
    if (!query.trim()) return deals;

    const lower = query.toLowerCase();
    return deals.filter((deal) =>
      (deal.clientName || "").toLowerCase().includes(lower) ||
      (deal.stage || "").toLowerCase().includes(lower) ||
      (deal.status || "").toLowerCase().includes(lower)
    );
  }, [deals, query]);

  return (
    <div className="deals-page">
      <div className="deals-header">
        <div className="deals-header-actions">
          <input
            className="app-search-input deals-search-input"
            type="text"
            placeholder="Search deals..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="deals-card">
        {loading ? (
          <div className="deals-empty">Loading deals...</div>
        ) : error ? (
          <div className="deals-empty">{error}</div>
        ) : filteredDeals.length === 0 ? (
          <div className="deals-empty">No deals found</div>
        ) : (
          <div className="deals-table-wrap">
            <table className="deals-table">
              <thead>
                <tr>
                  <th>Deal Ref</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Deal Value</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredDeals.map((deal) => (
                  <tr key={deal._id}>
                    <td>{deal.stage || "-"}</td>
                    <td>{deal.clientName || "-"}</td>
                    <td>
                      <span className={`deal-status ${deal.status || "open"}`}>
                        {deal.status || "open"}
                      </span>
                    </td>
                    <td>{formatCurrency(deal.dealValue)}</td>
                    <td>
                      <div className="deal-actions">
                        <button
                          className="deal-view-btn"
                          onClick={() => navigate(`/deals/${deal._id}`)}
                        >
                          View
                        </button>
                        <button
                          className="deal-quote-btn"
                          onClick={() => navigate(`/quotations/new?dealId=${deal._id}`)}
                        >
                          Create Quote
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
=======
import React from "react";
import Leads from "./Leads";

const Deals = () => {
  return <Leads defaultView="deals" />;
};

export default Deals;
>>>>>>> bd3b25a980fd0cb62a0dec353c742f37c89364e7
