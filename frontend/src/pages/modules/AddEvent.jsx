import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/AddEvent.css";

const AddEvent = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    eventName: "",
    industryText: "",
    startDate: "",
    endDate: "",
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
  const [locations, setLocations] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const bannerName = useMemo(() => formData.banner?.name || "No file selected", [formData.banner]);

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const { data } = await API.get("/events/meta");
        const locationList = Array.isArray(data?.locations) ? data.locations : [];

        setLocations(locationList);
      } catch (err) {
        setError(err?.response?.data?.message || "Failed to load event form metadata");
      }
    };

    loadMeta();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, banner: file }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      await API.post("/events", {
        name: formData.eventName.trim(),
        industryText: formData.industryText.trim(),
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        venue: formData.venue || formData.location,
        locationText: formData.location,
        stateText: formData.stateName.trim(),
        address: [formData.location.trim(), formData.stateName.trim()].filter(Boolean).join(", "),
        registrationFee: formData.fee === "" ? 0 : Number(formData.fee),
        attendeesCount: Number(formData.expectedAttendees || 0),
        exhibitorsCount: Number(formData.expectedExhibitors || 0),
        status: "upcoming",
        priorityTag: formData.priorityTag,
        websiteUrl: formData.eventWebsite.trim(),
        description: formData.description.trim()
      });
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
        <button type="button" className="back-btn" onClick={() => navigate("/events")}>
          Back to Events
        </button>
        <h2>Create New Event</h2>
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
                    required
                  />
                </label>

                <label>
                  Industry *
                  <input
                    type="text"
                    name="industryText"
                    value={formData.industryText}
                    onChange={handleChange}
                    placeholder="Type industry name"
                    required
                  />
                </label>

                <label>
                  Start Date *
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    required
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
                  City / Location *
                  <input
                    type="text"
                    name="location"
                    list="event-location-list"
                    placeholder="City"
                    value={formData.location}
                    onChange={handleChange}
                    required
                  />
                  <datalist id="event-location-list">
                    {locations.map((location) => (
                      <option
                        key={`${location.city || ""}-${location.State || location.state || ""}`}
                        value={location.city}
                      />
                    ))}
                  </datalist>
                </label>

                <label>
                  State *
                  <input
                    type="text"
                    name="stateName"
                    placeholder="State"
                    value={formData.stateName}
                    onChange={handleChange}
                    required
                  />
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
                    required
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
                    required
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="strategic">Strategic</option>
                  </select>
                </label>
              </div>

              {error && (
                <p style={{ color: "#b42318", marginTop: "12px", marginBottom: "0" }}>
                  {error}
                </p>
              )}

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
