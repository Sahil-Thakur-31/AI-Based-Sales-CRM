import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
import "./styles/LeadsDashboard.css";

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN");
}

export default function ClientDeals() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState("");
  const [deals, setDeals] = useState([]);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 8;

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError("");
        const [clientRes, dealsRes] = await Promise.all([
          API.get(`/clients/${id}`),
          API.get("/deals", { params: { client_id: id } }),
        ]);
        setClientName(clientRes.data?.client?.name || "Client");
        setDeals(Array.isArray(dealsRes.data) ? dealsRes.data : []);
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || "Failed to load client deals");
        setDeals([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((deals.length || 0) / itemsPerPage)),
    [deals.length]
  );

  const paginatedDeals = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return deals.slice(start, start + itemsPerPage);
  }, [deals, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [deals.length]);

  return (
    <div className="leads-container">
      <div className="leads-header">
        <h2>Deals For {clientName || "Client"}</h2>
        <div className="filters">
          <button className="btn" type="button" onClick={() => navigate(`/clients/${id}`)}>
            Back To Client
          </button>
          <button className="btn add-deal-btn" type="button" onClick={() => navigate(`/leads/new?view=deal&clientId=${id}`)}>
            <span className="action-icon">+</span>
            Add Deal
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Stage</th>
              <th>Value</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>Loading deals...</td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5}>{error}</td>
              </tr>
            ) : paginatedDeals.length ? (
              paginatedDeals.map((deal) => {
                const dealId = String(deal?._id || deal?.deal_id || "");
                return (
                  <tr key={dealId}>
                    <td className="company-cell">{deal.company_name || "-"}</td>
                    <td>{deal.stage || "-"}</td>
                    <td>{formatCurrency(deal.deal_value_estimate || deal.dealValue)}</td>
                    <td>{formatDate(deal.updatedAt || deal.last_contact_date)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="view-btn"
                          type="button"
                          onClick={() => navigate(`/leads/${dealId}?view=deal&dealId=${dealId}`)}
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5}>No deals found for this client.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && totalPages > 1 ? (
        <Pagination currentPage={currentPage} totalPages={totalPages} handlePageChange={setCurrentPage} />
      ) : null}
    </div>
  );
}
