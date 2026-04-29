import React, { useState } from "react";
import "./OutcomeForm.css";

const OutcomeForm = ({ isOpen, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    collectedLeads: "",
    qualifiedLeads: "",
    dealsClosed: "",
    generatedRevenue: "",
    investmentCost: "",
    notes: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = () => {
    // Convert to numbers or null
    const payload = {};
    
    const collectedLeads = Number(formData.collectedLeads || 0);
    const qualifiedLeads = Number(formData.qualifiedLeads || 0);
    const dealsClosed = Number(formData.dealsClosed || 0);
    const generatedRevenue = Number(formData.generatedRevenue || 0);
    const investmentCost = Number(formData.investmentCost || 0);
    const notes = String(formData.notes || "").trim();

    if (collectedLeads > 0) payload.collectedLeads = collectedLeads;
    if (qualifiedLeads > 0) payload.qualifiedLeads = qualifiedLeads;
    if (dealsClosed > 0) payload.dealsClosed = dealsClosed;
    if (generatedRevenue > 0) payload.generatedRevenue = generatedRevenue;
    if (investmentCost > 0) payload.investmentCost = investmentCost;
    if (notes) payload.notes = notes;

    onSubmit(payload);

    // Reset form
    setFormData({
      collectedLeads: "",
      qualifiedLeads: "",
      dealsClosed: "",
      generatedRevenue: "",
      investmentCost: "",
      notes: "",
    });
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
