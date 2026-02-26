import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../../api";
import "./styles/Deals.css";

const DEAL_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const DEAL_STATUSES = ["open", "won", "lost"];

function formatDateForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export default function DealDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dealForm, setDealForm] = useState(null);

  useEffect(() => {
    loadDetail();
  }, [id]);

  const loadDetail = async () => {
    try {
      setDetailLoading(true);
      setDetailError("");
      const res = await API.get(`/deals/${id}`);
      setDealForm(res.data);
    } catch (err) {
      console.error(err);
      setDetailError("Failed to load deal details");
    } finally {
      setDetailLoading(false);
    }
  };

  const updateDealField = (field, value) => {
    setDealForm((prev) => ({
      ...prev,
      deal: {
        ...prev.deal,
        [field]: value
      }
    }));
  };

  const updateClientField = (field, value) => {
    setDealForm((prev) => ({
      ...prev,
      client: {
        ...(prev.client || {}),
        [field]: value
      }
    }));
  };

  const updateContactField = (index, field, value) => {
    setDealForm((prev) => {
      const contacts = [...(prev.contacts || [])];
      contacts[index] = {
        ...contacts[index],
        [field]: value
      };
      return {
        ...prev,
        contacts
      };
    });
  };

  const saveDeal = async () => {
    if (!id || !dealForm) return;

    try {
      setSaving(true);
      setDetailError("");

      const payload = {
        deal: {
          stage: dealForm.deal?.stage || "",
          status: dealForm.deal?.status || "",
          dealValue: dealForm.deal?.dealValue ?? "",
          probability: dealForm.deal?.probability ?? "",
          expectedCloseDate: dealForm.deal?.expectedCloseDate || "",
          actualCloseDate: dealForm.deal?.actualCloseDate || "",
          aiRiskScore: dealForm.deal?.aiRiskScore ?? "",
          assignedTo: dealForm.deal?.assignedTo || "",
          assignedBy: dealForm.deal?.assignedBy || "",
          lead_id: dealForm.deal?.lead_id || "",
          isActive: dealForm.deal?.isActive,
          isDeleted: dealForm.deal?.isDeleted
        },
        client: dealForm.client
          ? {
            name: dealForm.client?.name || "",
            industry: dealForm.client?.industry || "",
            Address: dealForm.client?.Address || "",
            employeeCount: dealForm.client?.employeeCount ?? "",
            turnoverRange: dealForm.client?.turnoverRange || "",
            website: dealForm.client?.website || "",
            source: dealForm.client?.source || "",
            GST_no: dealForm.client?.GST_no || "",
            URD: dealForm.client?.URD || "",
            Aadhar_doc: dealForm.client?.Aadhar_doc || "",
            PanCard_doc: dealForm.client?.PanCard_doc || "",
            Other_docs: dealForm.client?.Other_docs || "",
            location: dealForm.client?.location || ""
          }
          : null,
        contacts: (dealForm.contacts || []).map((contact) => ({
          _id: contact._id,
          name: contact.name || "",
          designation: contact.designation || "",
          phone: contact.phone || "",
          email: contact.email || "",
          linkedin: contact.linkedin || "",
          is_active: contact.is_active
        }))
      };

      const res = await API.put(`/deals/${id}`, payload);
      setDealForm(res.data);
      navigate("/deals");
    } catch (err) {
      console.error(err);
      setDetailError("Failed to save deal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="deal-detail-page">
      <div className="deal-detail-topbar">
        <button className="deal-footer-btn deal-footer-cancel" onClick={() => navigate("/deals")}>
          Back to Deals
        </button>
        <button
          className="deal-footer-btn deal-footer-save"
          onClick={saveDeal}
          disabled={saving || detailLoading || !dealForm}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="deal-modal-card deal-detail-shell">
        <div className="deal-modal-header">
          <h3>Deal Details</h3>
        </div>

        <div className="deal-modal-body">
          {detailLoading ? (
            <div className="deal-modal-empty">Loading deal details...</div>
          ) : detailError ? (
            <div className="deal-modal-empty">{detailError}</div>
          ) : !dealForm ? (
            <div className="deal-modal-empty">No deal data found.</div>
          ) : (
            <>
              <h4 className="deal-section-title">Deal</h4>
              <div className="deal-edit-grid">
                <div className="deal-field">
                  <label>Stage</label>
                  <select
                    value={dealForm.deal?.stage || ""}
                    onChange={(e) => updateDealField("stage", e.target.value)}
                  >
                    <option value="">Select stage</option>
                    {DEAL_STAGES.map((stage) => (
                      <option key={stage} value={stage}>{stage}</option>
                    ))}
                  </select>
                </div>

                <div className="deal-field">
                  <label>Status</label>
                  <select
                    value={dealForm.deal?.status || ""}
                    onChange={(e) => updateDealField("status", e.target.value)}
                  >
                    <option value="">Select status</option>
                    {DEAL_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                <div className="deal-field">
                  <label>Deal Value</label>
                  <input
                    type="number"
                    value={dealForm.deal?.dealValue ?? ""}
                    onChange={(e) => updateDealField("dealValue", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Probability %</label>
                  <input
                    type="number"
                    value={dealForm.deal?.probability ?? ""}
                    onChange={(e) => updateDealField("probability", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Expected Close Date</label>
                  <input
                    type="date"
                    value={formatDateForInput(dealForm.deal?.expectedCloseDate)}
                    onChange={(e) => updateDealField("expectedCloseDate", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Actual Close Date</label>
                  <input
                    type="date"
                    value={formatDateForInput(dealForm.deal?.actualCloseDate)}
                    onChange={(e) => updateDealField("actualCloseDate", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>AI Risk Score</label>
                  <input
                    type="number"
                    value={dealForm.deal?.aiRiskScore ?? ""}
                    onChange={(e) => updateDealField("aiRiskScore", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Assigned To (User ID)</label>
                  <input
                    value={dealForm.deal?.assignedTo || ""}
                    onChange={(e) => updateDealField("assignedTo", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Assigned By (User ID)</label>
                  <input
                    value={dealForm.deal?.assignedBy || ""}
                    onChange={(e) => updateDealField("assignedBy", e.target.value)}
                  />
                </div>

                <div className="deal-field">
                  <label>Lead ID</label>
                  <input
                    value={dealForm.deal?.lead_id || ""}
                    onChange={(e) => updateDealField("lead_id", e.target.value)}
                  />
                </div>

                <div className="deal-field deal-checkbox-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(dealForm.deal?.isActive)}
                      onChange={(e) => updateDealField("isActive", e.target.checked)}
                    />
                    Active Deal
                  </label>
                </div>

                <div className="deal-field deal-checkbox-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(dealForm.deal?.isDeleted)}
                      onChange={(e) => updateDealField("isDeleted", e.target.checked)}
                    />
                    Mark as Deleted
                  </label>
                </div>
              </div>

              <h4 className="deal-section-title">Client</h4>
              {dealForm.client ? (
                <div className="deal-edit-grid">
                  <div className="deal-field">
                    <label>Client Name</label>
                    <input
                      value={dealForm.client?.name || ""}
                      onChange={(e) => updateClientField("name", e.target.value)}
                    />
                  </div>

                  <div className="deal-field">
                    <label>Website</label>
                    <input
                      value={dealForm.client?.website || ""}
                      onChange={(e) => updateClientField("website", e.target.value)}
                    />
                  </div>

                  <div className="deal-field">
                    <label>Employee Count</label>
                    <input
                      type="number"
                      value={dealForm.client?.employeeCount ?? ""}
                      onChange={(e) => updateClientField("employeeCount", e.target.value)}
                    />
                  </div>

                  <div className="deal-field">
                    <label>Turnover Range</label>
                    <input
                      value={dealForm.client?.turnoverRange || ""}
                      onChange={(e) => updateClientField("turnoverRange", e.target.value)}
                    />
                  </div>

                  <div className="deal-field deal-field-full">
                    <label>Address</label>
                    <input
                      value={dealForm.client?.Address || ""}
                      onChange={(e) => updateClientField("Address", e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="deal-modal-empty">No linked client.</div>
              )}

              <h4 className="deal-section-title">Client Contacts</h4>
              {!dealForm.contacts?.length ? (
                <div className="deal-modal-empty">No contacts found.</div>
              ) : (
                <div className="deal-contacts-grid">
                  {dealForm.contacts.map((contact, index) => (
                    <div className="deal-contact-card" key={contact._id || index}>
                      <div className="deal-edit-grid">
                        <div className="deal-field">
                          <label>Name</label>
                          <input
                            value={contact.name || ""}
                            onChange={(e) => updateContactField(index, "name", e.target.value)}
                          />
                        </div>
                        <div className="deal-field">
                          <label>Designation</label>
                          <input
                            value={contact.designation || ""}
                            onChange={(e) => updateContactField(index, "designation", e.target.value)}
                          />
                        </div>
                        <div className="deal-field">
                          <label>Phone</label>
                          <input
                            value={contact.phone || ""}
                            onChange={(e) => updateContactField(index, "phone", e.target.value)}
                          />
                        </div>
                        <div className="deal-field">
                          <label>Email</label>
                          <input
                            value={contact.email || ""}
                            onChange={(e) => updateContactField(index, "email", e.target.value)}
                          />
                        </div>
                        <div className="deal-field deal-field-full">
                          <label>LinkedIn</label>
                          <input
                            value={contact.linkedin || ""}
                            onChange={(e) => updateContactField(index, "linkedin", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="deal-section-title">Stage History</h4>
              {!dealForm.stageHistory?.length ? (
                <div className="deal-modal-empty">No stage history yet.</div>
              ) : (
                <div className="deal-history-list">
                  {dealForm.stageHistory.map((item) => (
                    <div className="deal-history-item" key={item._id}>
                      <span>{item.stage}</span>
                      <span>{formatDate(item.movedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
