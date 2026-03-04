import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import "./styles/QuotationDetails.css";
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

function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("blob:")) {
    return raw;
  }

  const base = String(API.defaults.baseURL || "").replace(/\/$/, "");
  return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function asReadable(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function joinReadable(values = [], separator = " | ") {
  const filtered = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return filtered.length ? filtered.join(separator) : "-";
}

function buildOrganizationAddress(org) {
  if (!org) return "-";
  const lines = [];

  if (org.address) lines.push(org.address);

  const locality = [org.area, org.city, org.district].filter(Boolean).join(", ");
  if (locality) lines.push(locality);

  const region = [org.state, org.country, org.pincode].filter(Boolean).join(" - ");
  if (region) lines.push(region);

  return lines.length ? lines.join("\n") : "-";
}

function buildClientAddress(client) {
  if (!client) return "-";
  return asReadable(client.Address);
}

export default function QuotationDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [organization, setOrganization] = useState(null);

  const loadDetails = async () => {
    try {
      setLoading(true);
      setError("");
      const [quoteRes, orgRes] = await Promise.allSettled([
        API.get(`/quotations/${id}`),
        API.get("/organizations/profile")
      ]);

      if (quoteRes.status !== "fulfilled") {
        throw quoteRes.reason;
      }

      setDetail(quoteRes.value.data || null);

      if (orgRes.status === "fulfilled") {
        setOrganization(orgRes.value.data?.organization || null);
      } else {
        setOrganization(null);
      }
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

  const handlePrint = () => {
    const currentTitle = document.title;
    document.title = `${detail?.quotation?.quoteNumber || "Quotation"}`;
    window.print();
    document.title = currentTitle;
  };

  if (loading) {
    return <div className="qdoc-empty">Loading quotation details...</div>;
  }

  if (error) {
    return <div className="qdoc-empty">{error}</div>;
  }

  if (!detail) {
    return <div className="qdoc-empty">No quotation data found.</div>;
  }

  return (
    <div className="qdoc-shell">
      <div className="qdoc-top-actions">
        <button className="qdoc-btn qdoc-btn-light" onClick={() => navigate("/quotations")}>
          Back
        </button>

        <div className="qdoc-top-actions-right">
        <button
          className="qdoc-btn qdoc-btn-primary"
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

        <button className="qdoc-btn qdoc-btn-success" onClick={handlePrint}>
          Print
        </button>
        </div>
      </div>

      <article className="qdoc-document">
        <header className="qdoc-letterhead">
          <div className="qdoc-brand-block">
            <div className="qdoc-brand-top">
              {organization?.logoUrl ? (
                <img
                  className="qdoc-logo"
                  src={resolveAssetUrl(organization.logoUrl)}
                  alt="Organization Logo"
                />
              ) : null}

              <div className="qdoc-brand-content">
                <h1>{asReadable(organization?.name)}</h1>
                <p className="qdoc-brand-address">{buildOrganizationAddress(organization)}</p>
                <p className="qdoc-brand-contact">
                  {joinReadable([
                    organization?.phoneNumber,
                    organization?.alternatePhoneNumber,
                    organization?.email,
                    organization?.website
                  ])}
                </p>
              </div>
            </div>
          </div>

          <div className="qdoc-title-block">
            <h2>Quotation</h2>
            <div className="qdoc-title-meta">
              <span>Quotation No.</span>
              <strong>{asReadable(detail.quotation.quoteNumber)}</strong>
            </div>
            <div className="qdoc-title-meta">
              <span>Date</span>
              <strong>{formatDate(detail.quotation.quoteDate)}</strong>
            </div>
            <div className="qdoc-title-meta">
              <span>Valid Until</span>
              <strong>{formatDate(detail.quotation.validUntil)}</strong>
            </div>
          </div>
        </header>

        <section className="qdoc-info-row">
          <div className="qdoc-to-panel">
            <h3>To</h3>
            <div>
              <p className="qdoc-field-value">{asReadable(detail.client?.name)}</p>
            </div>
            <div>
              <p className="qdoc-field-value">{buildClientAddress(detail.client)}</p>
            </div>
            <div>
              <p className="qdoc-field-value">
                {asReadable(detail.client?.contact?.name)}
                {detail.client?.contact?.designation
                  ? ` (${detail.client.contact.designation})`
                  : ""}
              </p>
            </div>
            <div>
              <p className="qdoc-field-value">
                {joinReadable([detail.client?.contact?.phone, detail.client?.contact?.email])}
              </p>
            </div>
          </div>

          <div className="qdoc-ref-panel">
            <h3>Reference</h3>
            <div className="qdoc-title-meta">
              <span>Deal Stage</span>
              <strong>{asReadable(detail.deal?.stage)}</strong>
            </div>
            <div className="qdoc-title-meta">
              <span>Currency</span>
              <strong>{asReadable(detail.quotation.currency || "INR")}</strong>
            </div>
          </div>
        </section>

        <section className="qdoc-items-section">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Disc%</th>
                <th>Tax%</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.items?.length ? (
                detail.items.map((item, index) => (
                  <tr key={item._id}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{item.productName}</strong>
                      {item.category ? <span className="qdoc-item-sub">{item.category}</span> : null}
                    </td>
                    <td>{item.quantity}</td>
                    <td>{formatCurrency(item.unitPrice)}</td>
                    <td>{item.discountPercent}%</td>
                    <td>{item.taxRate}%</td>
                    <td>{formatCurrency(item.netTotal)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="qdoc-no-items">
                    No line items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="qdoc-footer-grid">
          <div className="qdoc-notes-panel">
            <h4>Notes</h4>
            <p>{asReadable(detail.quotation.notes)}</p>

            <h4>Terms</h4>
            <p>{asReadable(detail.quotation.termsAndConditions)}</p>
          </div>

          <div className="qdoc-amount-panel">
            <div className="qdoc-total-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(totals?.subtotalAmount || 0)}</strong>
            </div>
            <div className="qdoc-total-row">
              <span>Tax</span>
              <strong>{formatCurrency(totals?.taxAmount || 0)}</strong>
            </div>
            <div className="qdoc-total-row">
              <span>Discount</span>
              <strong>{formatCurrency(totals?.discountAmount || 0)}</strong>
            </div>
            <div className="qdoc-total-row qdoc-grand">
              <span>Grand Total</span>
              <strong>{formatCurrency(totals?.grandTotal || 0)}</strong>
            </div>
          </div>
        </section>

        <footer className="qdoc-signoff">
          <div className="qdoc-signatory-block">
            <p>For {asReadable(organization?.name)}</p>
            <div className="qdoc-signature-stamp-row">
              <div className="qdoc-sign-visual">
                {organization?.signatureUrl ? (
                  <img
                    className="qdoc-signature-image"
                    src={resolveAssetUrl(organization.signatureUrl)}
                    alt="Authorized Signature"
                  />
                ) : (
                  <div className="qdoc-sign-placeholder">Authorized Signature</div>
                )}
              </div>
              <div className="qdoc-sign-visual qdoc-stamp-visual">
                {organization?.stampUrl ? (
                  <img
                    className="qdoc-stamp-image"
                    src={resolveAssetUrl(organization.stampUrl)}
                    alt="Organization Stamp"
                  />
                ) : (
                  <div className="qdoc-sign-placeholder">Company Stamp</div>
                )}
              </div>
            </div>
            <p className="qdoc-sign-caption">Authorized Signatory</p>
          </div>
          <p className="qdoc-generated-note">
            This is a system-generated quotation and does not require a physical signature.
          </p>
        </footer>
      </article>
    </div>
  );
}
