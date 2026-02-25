import React, { useState, useMemo } from "react";
import "./LeadsDashboard.css";
import { useNavigate } from "react-router-dom";


const dummyLeads = [
  {
    _id: "1",
    company_name: "SolarTech Industries",
    industry: "Solar",
    deal_value_estimate: 1250000,
    lead_temperature: "hot",
    status: "qualified",
    last_contact_date: "2026-02-22",
    next_action: "Follow-up call",
    employee_count: 150,
    turnover_range: "10Cr - 25Cr",
    Address: "Pune, Maharashtra",
    website: "www.solartech.com",
    is_existing_company: "Yes",
    converted_to_deal: "No",
  },
  {
    _id: "2",
    company_name: "Enertech Manufacturing",
    industry: "Manufacturing",
    deal_value_estimate: 950000,
    lead_temperature: "warm",
    status: "contacted",
    last_contact_date: "2026-02-20",
    next_action: "Send quotation",
    employee_count: 80,
    turnover_range: "5Cr - 10Cr",
    Address: "Mumbai, Maharashtra",
    website: "www.enertech.com",
    is_existing_company: "No",
    converted_to_deal: "No",
  },
];

function LeadsDashboard() {

  const navigate = useNavigate();

  const [selectedLead, setSelectedLead] = useState(null);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [temperatureFilter, setTemperatureFilter] = useState("All");

  const formatCurrency = (value) =>
    "₹" + (value / 100000).toFixed(1) + "L";

  /* ================= FILTER LOGIC ================= */
  const filteredLeads = useMemo(() => {
    return dummyLeads.filter((lead) => {
      const matchesSearch =
        lead.company_name.toLowerCase().includes(search.toLowerCase());

      const matchesIndustry =
        industryFilter === "All" || lead.industry === industryFilter;

      const matchesTemp =
        temperatureFilter === "All" ||
        lead.lead_temperature === temperatureFilter;

      return matchesSearch && matchesIndustry && matchesTemp;
    });
  }, [search, industryFilter, temperatureFilter]);

  return (
    <div className="leads-container">

      {/* ================= TOP ACTIONS ================= */}
      <div className="top-actions">
        <button className="btn">
          📇 Scan Business Card <span className="tag">OCR</span>
        </button>

        <button className="btn" onClick={() => navigate("/leads/new")}>
          ➕ Add Lead Manually
        </button>

        <button
          className="btn"
          onClick={() => setTemperatureFilter("hot")}
        >
          🔥 Hot Leads
        </button>

        <button
          className="btn"
          onClick={() => setTemperatureFilter("warm")}
        >
          🌡 Warm Leads
        </button>

        <button
          className="btn"
          onClick={() => setTemperatureFilter("cold")}
        >
          ❄ Cold Leads
        </button>

        <button className="btn">📥 Import CSV</button>
      </div>

      {/* ================= HEADER ================= */}
      <div className="leads-header">
        <h2>All Leads ({filteredLeads.length})</h2>

        <div className="filters">
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            <option value="All">All Industries</option>
            <option value="Solar">Solar</option>
            <option value="Manufacturing">Manufacturing</option>
          </select>
        </div>
      </div>

      {/* ================= TABLE ================= */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Industry</th>
              <th>Value</th>
              <th>Temperature</th>
              <th>Status</th>
              <th>Next Action</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filteredLeads.map((lead) => (
              <tr key={lead._id}>
                <td>{lead.company_name}</td>
                <td>{lead.industry}</td>
                <td>{formatCurrency(lead.deal_value_estimate)}</td>

                <td>
                  <span className={`badge ${lead.lead_temperature}`}>
                    {lead.lead_temperature}
                  </span>
                </td>

                <td>{lead.status}</td>
                <td>{lead.next_action}</td>

                <td>
                  <button
                    className="view-btn"
                    onClick={() => navigate(`/leads/${lead._id}`)}
                  >
                    View More
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ================= DETAIL PANEL ================= */}
      {selectedLead && (
        <div className="overlay">
          <div className="details-panel">

            <div className="panel-header">
              <h3>{selectedLead.company_name}</h3>
              <button onClick={() => setSelectedLead(null)}>✖</button>
            </div>

            <div className="details-grid">

              <div>
                <strong>Industry:</strong>
                <p>{selectedLead.industry}</p>
              </div>

              <div>
                <strong>Deal Estimate:</strong>
                <p>{formatCurrency(selectedLead.deal_value_estimate)}</p>
              </div>

              <div>
                <strong>Employees:</strong>
                <p>{selectedLead.employee_count}</p>
              </div>

              <div>
                <strong>Turnover:</strong>
                <p>{selectedLead.turnover_range}</p>
              </div>

              <div>
                <strong>Address:</strong>
                <p>{selectedLead.Address}</p>
              </div>

              <div>
                <strong>Website:</strong>
                <p>{selectedLead.website}</p>
              </div>

              <div>
                <strong>Status:</strong>
                <p>{selectedLead.status}</p>
              </div>

              <div>
                <strong>Converted:</strong>
                <p>{selectedLead.converted_to_deal}</p>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LeadsDashboard;