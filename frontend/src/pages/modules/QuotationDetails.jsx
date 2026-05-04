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

function asLineItems(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : ["-"];
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
  const roleName = String(localStorage.getItem("RoleName") || "").trim().toLowerCase();
  const isAdmin = roleName === "admin";

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
  const quoteType = String(detail?.quotation?.quoteType || (detail?.quotation?.leadId ? "lead" : "deal")).toLowerCase();

  const renderLetterhead = () => (
    <div className="qdoc-letterhead">
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
        <h2><b>Quotation</b></h2>
        <div className="qdoc-title-meta-stack">
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
      </div>
    </div>
  );

  const handlePrint = () => {
    const currentTitle = document.title;
    const pageContent = document.querySelector(".page-content");
    const prevWindowScrollY = window.scrollY || window.pageYOffset || 0;
    const prevContentScrollTop = pageContent?.scrollTop || 0;

    window.scrollTo(0, 0);
    if (pageContent) {
      pageContent.scrollTop = 0;
    }

    const restoreScroll = () => {
      window.scrollTo(0, prevWindowScrollY);
      if (pageContent) {
        pageContent.scrollTop = prevContentScrollTop;
      }
      window.removeEventListener("afterprint", restoreScroll);
    };

    window.addEventListener("afterprint", restoreScroll);
    document.title = `${detail?.quotation?.quoteNumber || "Quotation"}`;
    setTimeout(() => {
      window.print();
      document.title = currentTitle;
    }, 50);
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
          {!isAdmin ? (
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
                const sourceQuery =
                  quoteType === "lead"
                    ? `leadId=${detail?.quotation?.leadId || ""}`
                    : `dealId=${detail?.quotation?.dealId || ""}`;
                navigate(
                  `/quotations/new?${sourceQuery}&fromQuoteId=${detail?.quotation?._id || ""}`
                );
              }}
            >
              New Version
            </button>
          ) : null}

          <button className="qdoc-btn qdoc-btn-success" onClick={handlePrint}>
            Print
          </button>
        </div>
      </div>

      {}
      <article className="qdoc-document">
        <table className="qdoc-print-table">

          {}
          <thead className="qdoc-print-thead">
            <tr>
              <th className="qdoc-print-th">
                <div className="qdoc-print-header-space">
                  {renderLetterhead()}
                </div>
              </th>
            </tr>
          </thead>

          {}
          <tfoot className="qdoc-print-tfoot">
            <tr>
              <td className="qdoc-print-td">
                <div className="qdoc-print-footer-space">
                  <div className="qdoc-generated-note-row">
                    <p className="qdoc-generated-note">
                      This is a system-generated quotation and does not require a physical signature.
                    </p>
                  </div>
                </div>
              </td>
            </tr>
          </tfoot>

          {}
          <tbody>
            <tr>
              <td className="qdoc-print-td">

                {}
                <header className="qdoc-screen-header">
                  {renderLetterhead()}
                </header>

                <main className="qdoc-main-content">
                  <section className="qdoc-info-row">
                    <div className="qdoc-to-panel">
                      <h3>To</h3>
                      <p className="qdoc-field-value">{asReadable(detail.client?.name)}</p>
                      <p className="qdoc-field-value">{buildClientAddress(detail.client)}</p>
                      <p className="qdoc-field-value">
                        {asReadable(detail.client?.contact?.name)}
                        {detail.client?.contact?.designation
                          ? ` (${detail.client.contact.designation})`
                          : ""}
                      </p>
                      <p className="qdoc-field-value">
                        {joinReadable([detail.client?.contact?.phone, detail.client?.contact?.email])}
                      </p>
                    </div>

                    <div className="qdoc-ref-panel">
                      <h3>Reference</h3>
                      <div className="qdoc-ref-grid">
                        <div className="qdoc-title-meta">
                          <span>Reference Type</span>
                          <strong>{quoteType === "lead" ? "Lead" : "Deal"}</strong>
                        </div>
                        <div className="qdoc-title-meta">
                          <span>{quoteType === "lead" ? "Lead Status" : "Deal Stage"}</span>
                          <strong>{asReadable(quoteType === "lead" ? detail.lead?.status : detail.deal?.stage)}</strong>
                        </div>
                        <div className="qdoc-title-meta">
                          <span>Currency</span>
                          <strong>{asReadable(detail.quotation.currency || "INR")}</strong>
                        </div>
                        <div className="qdoc-title-meta">
                          <span>Status</span>
                          <strong>{asReadable(detail.quotation.status)}</strong>
                        </div>
                        <div className="qdoc-title-meta">
                          <span>Version</span>
                          <strong>v{asReadable(detail.quotation.version)}</strong>
                        </div>
                        <div className="qdoc-title-meta">
                          <span>Created By</span>
                          <strong>{asReadable(detail.quotation?.createdBy?.name)}</strong>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="qdoc-items-section">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Disc%</th>
                          <th>Tax%</th>
                          <th>Net Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items?.length ? (
                          detail.items.map((item, index) => (
                            <tr key={item._id}>
                              <td>{index + 1}</td>
                              <td>
                                <strong>{asReadable(item.productName)}</strong>
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

                  <section className="qdoc-totals-row">
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

                  <section className="qdoc-notes-panel qdoc-notes-panel-full">
                    <h4>Notes</h4>
                    <p className="qdoc-notes-private">{asReadable(detail.quotation.notes)}</p>
                  </section>

                  <section className="qdoc-notes-panel qdoc-notes-panel-full qdoc-print-only qdoc-keep-together qdoc-standard-block">
                    <div className="qdoc-clause-head">
                      <h4>Terms & Conditions</h4>
                    </div>
                    <ul className="qdoc-clause-list qdoc-legal-list">
                      {asLineItems(detail.quotation.termsAndConditions).map((line, index) => (
                        <li key={`tc-${index}`}>{line}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="qdoc-payment-terms-panel qdoc-print-only qdoc-keep-together qdoc-standard-block">
                    <div className="qdoc-clause-head">
                      <h4>Payment Terms</h4>
                    </div>
                    <ul className="qdoc-clause-list qdoc-legal-list">
                      {asLineItems(detail.quotation.paymentTerms).map((line, index) => (
                        <li key={`pt-${index}`}>{line}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="qdoc-payment-panel qdoc-print-only qdoc-keep-together qdoc-standard-block">
                    <div className="qdoc-clause-head">
                      <h4>Payment Details</h4>
                    </div>
                    <p className="qdoc-payment-intro">
                      For cheque payment: issue a cross cheque in the name of{" "}
                      <strong>{asReadable(organization?.paymentAccountName)}</strong>.
                    </p>
                    <h4 className="qdoc-payment-subtitle">For online payment</h4>
                    <div className="qdoc-payment-grid">
                      <div className="qdoc-payment-grid-row">
                        <span>Account Name</span>
                        <strong>{asReadable(organization?.paymentAccountName)}</strong>
                      </div>
                      <div className="qdoc-payment-grid-row">
                        <span>Account Number</span>
                        <strong>{asReadable(organization?.paymentAccountNumber)}</strong>
                      </div>
                      <div className="qdoc-payment-grid-row">
                        <span>Account Type</span>
                        <strong>{asReadable(organization?.paymentAccountType)}</strong>
                      </div>
                      <div className="qdoc-payment-grid-row">
                        <span>Bank</span>
                        <strong>{asReadable(organization?.paymentBankName)}</strong>
                      </div>
                      <div className="qdoc-payment-grid-row">
                        <span>IFSC Code</span>
                        <strong>{asReadable(organization?.paymentIfscCode)}</strong>
                      </div>
                      <div className="qdoc-payment-grid-row">
                        <span>UPI ID</span>
                        <strong>{asReadable(organization?.paymentUpiId)}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="qdoc-regards-panel qdoc-print-only qdoc-keep-together">
                    <p>Regards,</p>
                    <p>{asReadable(organization?.headName)}</p>
                    <p>{asReadable(organization?.headRole)}</p>
                    <p>{asReadable(organization?.name)}</p>
                  </section>
                </main>

                {}
                <footer className="qdoc-screen-footer">
                  <div className="qdoc-generated-note-row">
                    <p className="qdoc-generated-note">
                      This is a system-generated quotation and does not require a physical signature.
                    </p>
                  </div>
                </footer>

              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
