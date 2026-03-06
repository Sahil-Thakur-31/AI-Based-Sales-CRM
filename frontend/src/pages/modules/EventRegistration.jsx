import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/EventRegistration.css";

const toInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const EventRegistration = () => {
  const navigate = useNavigate();
  const { state } = useLocation();

  const eventDetails = useMemo(
    () => ({
      eventId: state?.eventId || "",
      eventName: state?.eventName || "Renewable Energy India Expo 2026",
      eventLocation: state?.eventLocation || "India Expo Centre, Greater Noida",
      eventDates: state?.eventDates || "March 15-17, 2026",
      registrationFee: toInt(state?.registrationFee, 0)
    }),
    [state]
  );

  const isPaidEvent = eventDetails.registrationFee > 0;
  const canSubmitEvent = Boolean(eventDetails.eventId);

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    mobile: "",
    companyName: "",
    designation: "",
    ticketType: "",
    city: "",
    attendeesCount: 1,
    specialRequirements: "",
    agreeTerms: false,
    paymentMethod: "UPI",
    paymentReferenceNo: "",
    amountPaid: "",
    paymentDate: "",
    paymentNotes: ""
  });

  const [allUsers, setAllUsers] = useState([]);
  const [attendeeSelections, setAttendeeSelections] = useState([""]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [error, setError] = useState("");
  const usersLoadedRef = useRef(false);
  const registrationLoadedKeyRef = useRef("");
  const attendeeUserOptions = useMemo(
    () =>
      allUsers.filter((user) => {
        const role = String(user?.roleName || "").trim().toLowerCase();
        return role !== "admin";
      }),
    [allUsers]
  );

  const onFieldChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  };

  const handleAttendeeCountChange = (event) => {
    const nextCount = Math.max(1, Math.min(20, toInt(event.target.value, 1)));
    setFormData((prev) => ({ ...prev, attendeesCount: nextCount }));
    setAttendeeSelections((prev) => {
      const next = Array.from({ length: nextCount }, (_, idx) => prev[idx] || "");
      return next;
    });
  };

  const handleAttendeeSelect = (index, userId) => {
    setAttendeeSelections((prev) => {
      const next = [...prev];
      next[index] = userId;
      return next;
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!canSubmitEvent) {
      setError("Open this page from a valid event to submit registration.");
      return;
    }

    setSubmitting(true);

    try {
      await API.put(`/events/${eventDetails.eventId}/register`, {
        attendeesCount: Number(formData.attendeesCount || 1),
        registrationData: {
          fullName: formData.fullName,
          email: formData.email,
          mobile: formData.mobile,
          companyName: formData.companyName,
          designation: formData.designation,
          ticketType: formData.ticketType,
          city: formData.city,
          specialRequirements: formData.specialRequirements,
          attendeeUsers: Array.from(new Set(attendeeSelections.filter(Boolean))),
          payment: isPaidEvent
            ? {
              method: formData.paymentMethod,
              referenceNo: formData.paymentReferenceNo,
              amountPaid: Number(formData.amountPaid || eventDetails.registrationFee),
              paymentDate: formData.paymentDate || null,
              notes: formData.paymentNotes
            }
            : {}
        }
      });
      setSubmitted(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to submit registration");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (usersLoadedRef.current) return;
    usersLoadedRef.current = true;
    const token = localStorage.getItem("token");
    if (!token) return;

    const loadUsers = async () => {
      try {
        const { data } = await API.get("/users");
        setAllUsers(Array.isArray(data) ? data : []);
      } catch {
        setAllUsers([]);
      }
    };
    loadUsers();
  }, []);

  useEffect(() => {
    const loadSavedRegistration = async () => {
      if (!canSubmitEvent) return;
      if (!state?.isRegistered) return;

      const fetchKey = String(eventDetails.eventId);
      if (registrationLoadedKeyRef.current === fetchKey) return;
      registrationLoadedKeyRef.current = fetchKey;

      try {
        setLoadingRegistration(true);
        const { data } = await API.get(`/events/${eventDetails.eventId}/my-registration`);
        const registration = data?.registration || {};
        const count = Math.max(1, Math.min(20, toInt(registration.attendeesCount, 1)));
        const selectedUsers = Array.isArray(registration.attendeeUsers)
          ? registration.attendeeUsers.map((item) => String(item?._id || item || ""))
          : [];
        setFormData((prev) => ({
          ...prev,
          fullName: registration.fullName || "",
          email: registration.email || "",
          mobile: registration.mobile || "",
          companyName: registration.companyName || "",
          designation: registration.designation || "",
          ticketType: registration.ticketType || "",
          city: registration.city || "",
          attendeesCount: count,
          specialRequirements: registration.specialRequirements || "",
          agreeTerms: true,
          paymentMethod: registration.payment?.method || "UPI",
          paymentReferenceNo: registration.payment?.referenceNo || "",
          amountPaid: registration.payment?.amountPaid ? String(registration.payment.amountPaid) : "",
          paymentDate: registration.payment?.paymentDate
            ? new Date(registration.payment.paymentDate).toISOString().slice(0, 10)
            : "",
          paymentNotes: registration.payment?.notes || ""
        }));
        setAttendeeSelections(
          Array.from({ length: count }, (_, idx) => selectedUsers[idx] || "")
        );
      } catch (err) {
        if (err?.response?.status !== 404) {
          setError(err?.response?.data?.message || "Failed to load saved registration");
        }
      } finally {
        setLoadingRegistration(false);
      }
    };

    loadSavedRegistration();
  }, [canSubmitEvent, eventDetails.eventId, state?.isRegistered]);

  return (
    <div className="event-registration-page">
      <div className="event-registration-header">
        <button className="back-button" type="button" onClick={() => navigate("/events")}>
          Back to Events
        </button>
        <h2>Event Registration</h2>
        
      </div>

      <section className="event-summary-strip">
        <div>
          <p className="summary-label">Event</p>
          <h3>{eventDetails.eventName}</h3>
        </div>
        <div>
          <p className="summary-label">Venue</p>
          <p>{eventDetails.eventLocation}</p>
        </div>
        <div>
          <p className="summary-label">Date</p>
          <p>{eventDetails.eventDates}</p>
        </div>
        <div>
          <p className="summary-label">Fee</p>
          <p>{isPaidEvent ? `Rs. ${eventDetails.registrationFee}` : "Free Event"}</p>
        </div>
      </section>

      <section className="event-form-card">
        {!canSubmitEvent && (
          <p className="loading-note">Open this page from an event card to continue.</p>
        )}
        {loadingRegistration && !submitted && (
          <p className="loading-note">Loading saved registration...</p>
        )}

        {submitted ? (
          <div className="success-box">
            <h3>Registration Submitted</h3>
            <p>Registration and attendee details were saved successfully.</p>
            <button type="button" onClick={() => navigate("/events")}>Go to Events</button>
          </div>
        ) : (
          <form className="registration-form" onSubmit={onSubmit}>
            <section className="form-section">
              <h4 className="section-title">Primary Contact</h4>
              <div className="form-grid">
                <label>
                  Full Name *
                  <input type="text" name="fullName" value={formData.fullName} onChange={onFieldChange} required />
                </label>

                <label>
                  Email *
                  <input type="email" name="email" value={formData.email} onChange={onFieldChange} required />
                </label>

                <label>
                  Mobile *
                  <input
                    type="tel"
                    name="mobile"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    value={formData.mobile}
                    onChange={onFieldChange}
                    required
                  />
                </label>

                <label>
                  Company Name *
                  <input type="text" name="companyName" value={formData.companyName} onChange={onFieldChange} required />
                </label>

                <label>
                  Designation *
                  <input type="text" name="designation" value={formData.designation} onChange={onFieldChange} required />
                </label>

                <label>
                  City *
                  <input type="text" name="city" value={formData.city} onChange={onFieldChange} required />
                </label>

                <label>
                  Ticket Type (Optional)
                  <select name="ticketType" value={formData.ticketType} onChange={onFieldChange}>
                    <option value="">Select ticket type</option>
                    <option value="Business Visitor">Business Visitor</option>
                    <option value="Conference Delegate">Conference Delegate</option>
                    <option value="VIP Access">VIP Access</option>
                  </select>
                </label>

                <label>
                  Number of Attendees *
                  <input
                    type="number"
                    name="attendeesCount"
                    min="1"
                    max="20"
                    value={formData.attendeesCount}
                    onChange={handleAttendeeCountChange}
                    required
                  />
                </label>
              </div>
            </section>

            <section className="form-section">
              <h4 className="section-title">Attendee Selection</h4>
              <p className="section-note">Select users who will attend this event.</p>
              <div className="attendee-grid">
                {attendeeSelections.map((selectedUser, idx) => (
                  <label key={`attendee-${idx}`}>
                    Attendee {idx + 1}
                    <select
                      value={selectedUser}
                      onChange={(event) => handleAttendeeSelect(idx, event.target.value)}
                    >
                      <option value="">Select user</option>
                      {attendeeUserOptions.map((user) => (
                        <option key={user._id} value={user._id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section className="form-section">
              <label className="full-width">
                Special Requirements (Optional)
                <textarea
                  name="specialRequirements"
                  rows="3"
                  value={formData.specialRequirements}
                  onChange={onFieldChange}
                  placeholder="Accessibility, seating, or special instructions."
                />
              </label>
            </section>

            {isPaidEvent && (
              <section className="form-section">
                <h4 className="section-title">Payment Details</h4>
                <div className="payment-panel">
                  <div className="form-grid">
                    <label>
                      Payment Method *
                      <select name="paymentMethod" value={formData.paymentMethod} onChange={onFieldChange} required>
                        <option value="UPI">UPI</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Debit Card">Debit Card</option>
                        <option value="Net Banking">Net Banking</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                    </label>

                    <label>
                      Amount Paid (INR) *
                      <input
                        type="number"
                        min="0"
                        name="amountPaid"
                        value={formData.amountPaid}
                        onChange={onFieldChange}
                        placeholder={String(eventDetails.registrationFee)}
                        required
                      />
                    </label>

                    <label>
                      Payment Date
                      <input type="date" name="paymentDate" value={formData.paymentDate} onChange={onFieldChange} />
                    </label>

                    <label>
                      Reference No
                      <input
                        type="text"
                        name="paymentReferenceNo"
                        value={formData.paymentReferenceNo}
                        onChange={onFieldChange}
                        placeholder="UTR / Transaction ID"
                      />
                    </label>
                  </div>

                  <label className="full-width">
                    Payment Notes (Optional)
                    <textarea
                      name="paymentNotes"
                      rows="2"
                      value={formData.paymentNotes}
                      onChange={onFieldChange}
                      placeholder="Any finance or payment remarks"
                    />
                  </label>
                </div>
              </section>
            )}

            <section className="form-section">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="agreeTerms"
                  checked={formData.agreeTerms}
                  onChange={onFieldChange}
                  required
                />
                I agree to the event terms and registration policy.
              </label>

              {error && <p className="error-text">{error}</p>}

              <div className="submit-row">
                <button className="submit-btn" type="submit" disabled={submitting || !canSubmitEvent}>
                  {submitting ? "Submitting..." : "Submit Registration"}
                </button>
              </div>
            </section>
          </form>
        )}
      </section>
    </div>
  );
};

export default EventRegistration;
