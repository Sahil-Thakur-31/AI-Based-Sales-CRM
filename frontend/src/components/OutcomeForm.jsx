import React, { useEffect, useState } from "react";
import "./OutcomeForm.css";

const toOptionalNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const OutcomeForm = ({ isOpen, onSubmit, onCancel, allowEmptySubmit = false }) => {
  const [formData, setFormData] = useState({
    collectedLeads: "",
    qualifiedLeads: "",
    dealsClosed: "",
    generatedRevenue: "",
    investmentCost: "",
    notes: "",
  });
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSubmitError("");
    }
  }, [isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSubmitError("");
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = () => {
    const payload = {};

    const collectedLeads = toOptionalNonNegativeNumber(formData.collectedLeads);
    const qualifiedLeads = toOptionalNonNegativeNumber(formData.qualifiedLeads);
    const dealsClosed = toOptionalNonNegativeNumber(formData.dealsClosed);
    const generatedRevenue = toOptionalNonNegativeNumber(formData.generatedRevenue);
    const investmentCost = toOptionalNonNegativeNumber(formData.investmentCost);
    const notes = String(formData.notes || "").trim();

    if (collectedLeads !== null) payload.collectedLeads = collectedLeads;
    if (qualifiedLeads !== null) payload.qualifiedLeads = qualifiedLeads;
    if (dealsClosed !== null) payload.dealsClosed = dealsClosed;
    if (generatedRevenue !== null) payload.generatedRevenue = generatedRevenue;
    if (investmentCost !== null) payload.investmentCost = investmentCost;
    if (notes) payload.notes = notes;

    if (!allowEmptySubmit && !Object.keys(payload).length) {
      setSubmitError("Add at least one outcome field before saving.");
      return;
    }

    onSubmit(payload);

    setFormData({
      collectedLeads: "",
      qualifiedLeads: "",
      dealsClosed: "",
      generatedRevenue: "",
      investmentCost: "",
      notes: "",
    });
    setSubmitError("");
  };

  const handleCancel = () => {
    setFormData({
      collectedLeads: "",
      qualifiedLeads: "",
      dealsClosed: "",
      generatedRevenue: "",
      investmentCost: "",
      notes: "",
    });
    setSubmitError("");
    onCancel();
  };

  if (!isOpen) return null;

  return (
    <div className="outcome-form-overlay">
      <div className="outcome-form-modal">
        <div className="outcome-form-header">
          <h3>Event Outcome Details</h3>
          <button className="close-btn" onClick={handleCancel}>✕</button>
        </div>

        <div className="outcome-form-body">
          {submitError && (
            <div className="outcome-form-error">{submitError}</div>
          )}
          <div className="form-group">
            <label htmlFor="collectedLeads">Collected Leads</label>
            <input
              type="number"
              id="collectedLeads"
              name="collectedLeads"
              value={formData.collectedLeads}
              onChange={handleChange}
              placeholder="e.g., 25"
              min="0"
            />
          </div>

          <div className="form-group">
            <label htmlFor="qualifiedLeads">Qualified Leads</label>
            <input
              type="number"
              id="qualifiedLeads"
              name="qualifiedLeads"
              value={formData.qualifiedLeads}
              onChange={handleChange}
              placeholder="e.g., 10"
              min="0"
            />
          </div>

          <div className="form-group">
            <label htmlFor="dealsClosed">Deals Closed</label>
            <input
              type="number"
              id="dealsClosed"
              name="dealsClosed"
              value={formData.dealsClosed}
              onChange={handleChange}
              placeholder="e.g., 3"
              min="0"
            />
          </div>

          <div className="form-group">
            <label htmlFor="generatedRevenue">Revenue Generated (₹)</label>
            <input
              type="number"
              id="generatedRevenue"
              name="generatedRevenue"
              value={formData.generatedRevenue}
              onChange={handleChange}
              placeholder="e.g., 150000"
              min="0"
              step="1000"
            />
          </div>

          <div className="form-group">
            <label htmlFor="investmentCost">Investment Spent (₹)</label>
            <input
              type="number"
              id="investmentCost"
              name="investmentCost"
              value={formData.investmentCost}
              onChange={handleChange}
              placeholder="e.g., 5000"
              min="0"
              step="1000"
            />
          </div>

          <div className="form-group">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Add any additional notes about this event..."
              rows="3"
            />
          </div>
        </div>

        <div className="outcome-form-footer">
          <button className="btn-cancel" onClick={handleCancel}>
            Cancel
          </button>
          <button className="btn-submit" onClick={handleSubmit}>
            Save Outcome
          </button>
        </div>
      </div>
    </div>
  );
};

export default OutcomeForm;
