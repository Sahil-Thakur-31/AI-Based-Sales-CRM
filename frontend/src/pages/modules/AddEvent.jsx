import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
import { minLength, required } from "../../utils/formValidation";
import "./styles/AddEvent.css";

const INDIA_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];

const AddEvent = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    eventName: "",
    industry: "",
    industryText: "",
    startDate: "",
    endDate: "",
    country: "India",
    location: "",
    stateName: "",
    venue: "",
    fee: "",
    expectedAttendees: "",
    expectedExhibitors: "",
    eventWebsite: "",
    description: "",
    banner: null,
    priorityTag: "medium"
  });
  const [industries, setIndustries] = useState([]);
  const [locations, setLocations] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const bannerName = useMemo(() => formData.banner?.name || "No file selected", [formData.banner]);
  const cityOptions = useMemo(() => {
    const selectedState = String(formData.stateName || "").trim().toLowerCase();
    const citySet = new Set();

    locations.forEach((item) => {
      const city = String(item?.city || "").trim();
      const state = String(item?.State || item?.state || "").trim().toLowerCase();
      if (!city) return;
      if (selectedState && state !== selectedState) return;
      citySet.add(city);
    });

    return Array.from(citySet).sort((a, b) => a.localeCompare(b));
  }, [locations, formData.stateName]);

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const { data } = await API.get("/events/meta");
        const industryList = Array.isArray(data?.industries) ? data.industries : [];
        const locationList = Array.isArray(data?.locations) ? data.locations : [];

        setIndustries(industryList);
        setLocations(locationList);
      } catch (err) {
        setError(err?.response?.data?.message || "Failed to load event form metadata");
      }
    };

    loadMeta();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setError("");
    setFormData((prev) => {
      if (name === "industry") {
        return {
          ...prev,
          industry: value,
          industryText: value === "other" ? prev.industryText : ""
        };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, banner: file }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const selectedIndustry = String(formData.industry || "").trim();
    const customIndustry = String(formData.industryText || "").trim();
    const checks = [
      required(formData.eventName, "Event name"),
      required(selectedIndustry, "Industry"),
      selectedIndustry === "other" ? required(customIndustry, "Other industry") : "",
      required(formData.startDate, "Start date"),
      required(formData.country, "Country"),
      required(formData.stateName, "State"),
      required(formData.location, "City / location"),
      minLength(formData.description, 3, "Description"),
    ];
    const firstError = checks.find(Boolean) || "";
    if (firstError) {
      setError(firstError);
      return;
    }

    setSaving(true);

    try {
      const selectedIndustryName = industries.find((item) => String(item._id) === selectedIndustry)?.name || "";
      const payload = {
        name: formData.eventName.trim(),
        industryText: selectedIndustry === "other" ? customIndustry : selectedIndustryName,
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        venue: formData.venue || formData.location,
        locationText: formData.location,
        stateText: formData.stateName.trim(),
        address: [
          formData.location.trim(),
          formData.stateName.trim(),
          formData.country.trim()
        ]
          .filter(Boolean)
          .join(", "),
        registrationFee: formData.fee === "" ? 0 : Number(formData.fee),
        attendeesCount: Number(formData.expectedAttendees || 0),
        exhibitorsCount: Number(formData.expectedExhibitors || 0),
        status: "upcoming",
        priorityTag: formData.priorityTag,
        websiteUrl: formData.eventWebsite.trim(),
        description: formData.description.trim()
      };

      if (selectedIndustry !== "other") {
        payload.industry = selectedIndustry;
      }

      await API.post("/events", payload);
      setSubmitted(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-event-page">
      <header className="add-event-header">
        <div className="add-event-header-row">
          <h2>Create New Event</h2>
          <button type="button" className="back-btn" onClick={() => navigate("/events")}>
            Back to Events
          </button>
        </div>
        <p>Add upcoming events with clear business details for your sales team.</p>
      </header>

      <div className="add-event-layout">
        <section className="add-event-form-card">
          {submitted ? (
            <div className="submit-success">
              <h3>Event Created Successfully</h3>
              <p>Your event has been saved. You can now view it in the Events module.</p>
              <button type="button" onClick={() => navigate("/events")}>
                Go to Events
              </button>
            </div>
          ) : (
            <form className="add-event-form" onSubmit={handleSubmit}>
              <p className="form-note">Fields marked with * are required.</p>
              <div className="form-grid">
                <label>
                  Event Name *
                  <input
                    type="text"
                    name="eventName"
                    value={formData.eventName}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Industry *
                  <select
                    name="industry"
                    value={formData.industry}
                    onChange={handleChange}
                  >
                    <option value="">Select industry</option>
                    {industries.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                    <option value="other">Other</option>
                  </select>
                </label>

                {formData.industry === "other" && (
                  <label>
                    Other Industry *
                    <input
                      type="text"
                      name="industryText"
                      value={formData.industryText}
                      onChange={handleChange}
                      placeholder="Type industry name"
                    />
                  </label>
                )}

                <label>
                  Start Date *
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  End Date
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Country *
                  <select
                    name="country"
                    value={formData.country}
                    onChange={handleChange}
                  >
                    <option value="India">India</option>
                  </select>
                </label>

                <label>
                  State *
                  <select
                    name="stateName"
                    value={formData.stateName}
                    onChange={handleChange}
                  >
                    <option value="">Select state</option>
                    {INDIA_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  City *
                  <input
                    type="text"
                    name="location"
                    list="event-city-list"
                    placeholder="City"
                    value={formData.location}
                    onChange={handleChange}
                  />
                  <datalist id="event-city-list">
                    {cityOptions.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                </label>

                <label>
                  Venue
                  <input
                    type="text"
                    name="venue"
                    value={formData.venue}
                    onChange={handleChange}
                    placeholder="Exhibition center / hall"
                  />
                </label>

                <label>
                  Registration Fee (INR)
                  <input
                    type="number"
                    name="fee"
                    min="0"
                    step="1"
                    placeholder="0 for free event"
                    value={formData.fee}
                    onChange={handleChange}
                  />
                  <span className="fee-note">Leave blank or set 0 if this event is free.</span>
                </label>

                <label>
                  Expected Attendees
                  <input
                    type="number"
                    name="expectedAttendees"
                    min="0"
                    step="1"
                    value={formData.expectedAttendees}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Expected Exhibitors
                  <input
                    type="number"
                    name="expectedExhibitors"
                    min="0"
                    step="1"
                    value={formData.expectedExhibitors}
                    onChange={handleChange}
                  />
                </label>

                <label className="full-row">
                  Event Website
                  <input
                    type="url"
                    name="eventWebsite"
                    placeholder="https://"
                    value={formData.eventWebsite}
                    onChange={handleChange}
                  />
                </label>

                <label className="full-row">
                  Description *
                  <textarea
                    name="description"
                    rows="4"
                    value={formData.description}
                    onChange={handleChange}
                  />
                </label>

                <label className="full-row">
                  Banner (Optional)
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <span className="file-name">{bannerName}</span>
                </label>

                <label>
                  Priority
                  <select
                    name="priorityTag"
                    value={formData.priorityTag}
                    onChange={handleChange}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="strategic">Strategic</option>
                  </select>
                </label>
              </div>

              <FormErrorSlot message={error} className="form-error-slot-global" />

              <div className="form-actions">
                <button type="button" className="secondary-btn" onClick={() => navigate("/events")}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? "Saving..." : "Save Event"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};

export default AddEvent;
