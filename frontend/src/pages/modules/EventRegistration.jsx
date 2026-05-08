import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../../api";
import ConfirmDialog from "../../components/ConfirmDialog";
import FormErrorSlot from "../../components/FormErrorSlot";
import { required } from "../../utils/formValidation";
import "./styles/EventRegistration.css";

const toInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toOptionalNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const formatFee = (amountValue, currencyValue, freeLabel = "Free Event") => {
  const amount = Number(amountValue || 0);
  if (!Number.isFinite(amount) || amount <= 0) return freeLabel;

  const currency = String(currencyValue || "").trim().toUpperCase() || "INR";
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;

  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    })}`;
  }
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
      registrationFee: toInt(state?.registrationFee, 0),
      registrationCurrency: String(state?.registrationCurrency || "INR").trim().toUpperCase() || "INR"
    }),
    [state]
  );

  const canSubmitEvent = Boolean(eventDetails.eventId);
  const isViewOnly = Boolean(state?.viewOnly);
  const defaultIsPaymentRequired = Number(eventDetails.registrationFee || 0) > 0;

  const [formData, setFormData] = useState({
    eventManagerUserId: "",
    participationRole: "",
    eventWebsiteUrl: "",
    attendeesCount: 1,
    specialRequirements: "",
    agreeTerms: false,
    isPaymentRequired: defaultIsPaymentRequired,
    paymentMethod: "UPI",
    paymentReferenceNo: "",
    amountPaid: "",
    paymentDate: "",
    paymentNotes: "",
    paymentScreenshot: null
  });
  const [registrationLocked, setRegistrationLocked] = useState(Boolean(state?.registrationLocked));
  const [hasSavedPaymentScreenshot, setHasSavedPaymentScreenshot] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState("");

  const [allUsers, setAllUsers] = useState([]);
  const [attendeeSelections, setAttendeeSelections] = useState([""]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [error, setError] = useState("");
  const [outcomeFormData, setOutcomeFormData] = useState({
    collectedLeads: "",
    qualifiedLeads: "",
    dealsClosed: "",
    generatedRevenue: "",
    investmentCost: "",
    notes: "",
  });
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  const [outcomeError, setOutcomeError] = useState("");
  const [outcomeSuccess, setOutcomeSuccess] = useState("");
  const [currentRealizedRoi, setCurrentRealizedRoi] = useState(null);
  const [currentEventStatus, setCurrentEventStatus] = useState("registered");
  const [currentMissedReason, setCurrentMissedReason] = useState("");
  const [missedReasonDraft, setMissedReasonDraft] = useState("");
  const [missedReasonSaving, setMissedReasonSaving] = useState(false);
  const [missedReasonError, setMissedReasonError] = useState("");
  const [missedReasonSuccess, setMissedReasonSuccess] = useState("");
  const [registrationConfirmOpen, setRegistrationConfirmOpen] = useState(false);
  const [registrationSavedPopupOpen, setRegistrationSavedPopupOpen] = useState(false);
  const usersLoadedRef = useRef(false);
  const registrationLoadedKeyRef = useRef("");
  const attendeeUserOptions = useMemo(
    () =>
      allUsers.filter((user) => {
        const role = String(user?.roleName || "").trim().toLowerCase();
        return role !== "admin" && String(user?._id || "") !== String(formData.eventManagerUserId || "");
      }),
    [allUsers, formData.eventManagerUserId]
  );
  const managerUserOptions = useMemo(
    () =>
      allUsers.filter((user) => String(user?.roleName || "").trim().toLowerCase() === "manager"),
    [allUsers]
  );

  const resolveEventStatus = (eventInput) => {
    const eventData = eventInput || {};
    const hasAttendance = Array.isArray(eventData.attendedBy) && eventData.attendedBy.length > 0;
    if (hasAttendance || Boolean(eventData.isAttending)) return "attended";
    const markedMissed = Boolean(eventData.isMissed || String(eventData.missedReason || "").trim());
    if (markedMissed) return "missed";
    return "registered";
  };

  const onFieldChange = (event) => {
    const { name, value, type, checked } = event.target;
    setError("");
    setRegistrationSuccess("");
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));

    if (name === "eventManagerUserId") {
      const selectedManagerId = String(value || "");
      setAttendeeSelections((prev) =>
        prev.map((attendeeId) =>
          String(attendeeId || "") === selectedManagerId ? "" : attendeeId
        )
      );
    }
  };

  const handlePaymentScreenshotChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setFormData((prev) => ({ ...prev, paymentScreenshot: null }));
      return;
    }

    // Max file size: 10MB
    if (file.size > 10 * 1024 * 1024) {
      setError("Payment screenshot must be less than 10MB. Please choose a smaller file.");
      return;
    }

    setFormData((prev) => ({
      ...prev,
      paymentScreenshot: file
    }));
    setRegistrationSuccess("");
    setError("");
  };

  const handleAttendeeCountChange = (event) => {
    const nextCount = Math.max(1, Math.min(20, toInt(event.target.value, 1)));
    setError("");
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
    setRegistrationSuccess("");

    if (isViewOnly) {
      setError("This page is in view-only mode.");
      return;
    }
    if (registrationLocked) {
      setError("Registration details are locked after attendance is marked.");
      return;
    }

    if (!canSubmitEvent) {
      setError("Open this page from a valid event to submit registration.");
      return;
    }

    const checks = [
      required(formData.eventManagerUserId, "Organization event manager"),
      required(formData.participationRole, "Participation role"),
      required(formData.eventWebsiteUrl, "Event website URL"),
      Number(formData.attendeesCount || 0) < 1 ? "Number of attendees must be at least 1" : "",
      Array.from(new Set(attendeeSelections.filter(Boolean))).length !== Number(formData.attendeesCount || 0)
        ? "Selected attendees must match attendee count" : "",
      !formData.agreeTerms ? "You must agree to the event terms and registration policy" : "",
      formData.isPaymentRequired && !String(formData.paymentMethod || "").trim() ? "Payment method is required" : "",
      formData.isPaymentRequired && !String(formData.paymentReferenceNo || "").trim() ? "Payment reference no is required" : "",
      formData.isPaymentRequired && Number(formData.amountPaid || 0) < 0 ? "Amount paid cannot be negative" : "",
      formData.isPaymentRequired && !String(formData.paymentDate || "").trim() ? "Payment date is required" : "",
      formData.isPaymentRequired && (!formData.paymentScreenshot && !hasSavedPaymentScreenshot) ? "Payment screenshot is required" : "",
    ];
    const firstError = checks.find(Boolean) || "";
    if (firstError) {
      setError(firstError);
      return;
    }

    setRegistrationConfirmOpen(true);
  };

  const submitRegistration = async () => {
    setSubmitting(true);
    setRegistrationConfirmOpen(false);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("attendeesCount", Number(formData.attendeesCount || 1));
      formDataToSend.append("eventManagerUserId", formData.eventManagerUserId);
      formDataToSend.append("participationRole", formData.participationRole);
      formDataToSend.append("websiteUrl", formData.eventWebsiteUrl);
      formDataToSend.append("specialRequirements", formData.specialRequirements);
      formDataToSend.append("attendeeUsers", JSON.stringify(Array.from(new Set(attendeeSelections.filter(Boolean)))));
      formDataToSend.append("isPaymentRequired", formData.isPaymentRequired ? "true" : "false");
      if (formData.isPaymentRequired) {
        formDataToSend.append("paymentMethod", formData.paymentMethod);
        formDataToSend.append("paymentReferenceNo", formData.paymentReferenceNo);
        formDataToSend.append("amountPaid", Number(formData.amountPaid || eventDetails.registrationFee || 0));
        formDataToSend.append("paymentDate", formData.paymentDate || null);
        formDataToSend.append("paymentNotes", formData.paymentNotes);
        if (formData.paymentScreenshot) {
          formDataToSend.append("paymentScreenshot", formData.paymentScreenshot);
        }
      }

      const { data } = await API.put(`/events/${eventDetails.eventId}/register`, formDataToSend, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });
      const savedRegistration = data?.myRegistration || {};
      applyRegistrationToForm(savedRegistration);
      setHasSavedPaymentScreenshot(Boolean(savedRegistration?.payment?.screenshotPath));
      setRegistrationLocked(Boolean(data?.registrationLocked));
      applyOutcomeToForm(data || {});
      setCurrentEventStatus(resolveEventStatus(data || {}));
      setCurrentMissedReason(String(data?.missedReason || ""));
      setMissedReasonDraft(String(data?.missedReason || ""));
      setRegistrationSuccess("Registration details saved.");
      setRegistrationSavedPopupOpen(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to submit registration");
    } finally {
      setSubmitting(false);
    }
  };

  const applyRegistrationToForm = (registrationInput) => {
    const registration = registrationInput || {};
    const count = Math.max(1, Math.min(20, toInt(registration.attendeesCount, 1)));
    const managerUserId = String(registration.eventManagerUser?._id || registration.eventManagerUser || "");
    const selectedUsers = Array.isArray(registration.attendeeUsers)
      ? registration.attendeeUsers
        .map((item) => String(item?._id || item || ""))
        .filter((userId) => userId && userId !== managerUserId)
      : [];

    setFormData((prev) => ({
      ...prev,
      eventManagerUserId: managerUserId,
      participationRole: registration.participationRole || "",
      eventWebsiteUrl: registration.websiteUrl || "",
      attendeesCount: count,
      specialRequirements: registration.specialRequirements || "",
      agreeTerms: true,
      isPaymentRequired: registration.isPaymentRequired !== undefined ? registration.isPaymentRequired !== false : defaultIsPaymentRequired,
      paymentMethod: registration.payment?.method || "UPI",
      paymentReferenceNo: registration.payment?.referenceNo || "",
      amountPaid: registration.payment?.amountPaid ? String(registration.payment.amountPaid) : "",
      paymentDate: registration.payment?.paymentDate
        ? new Date(registration.payment.paymentDate).toISOString().slice(0, 10)
        : "",
      paymentNotes: registration.payment?.notes || "",
      paymentScreenshot: null
    }));
    setHasSavedPaymentScreenshot(Boolean(registration.isPaymentRequired !== false && registration.payment?.screenshotPath));

    setAttendeeSelections(
      Array.from({ length: count }, (_, idx) => selectedUsers[idx] || "")
    );
  };

  const applyOutcomeToForm = (eventInput) => {
    const eventData = eventInput || {};
    setOutcomeFormData({
      collectedLeads: eventData.realizedCollectedLeads === null || eventData.realizedCollectedLeads === undefined ? "" : String(eventData.realizedCollectedLeads),
      qualifiedLeads: eventData.realizedQualifiedLeads === null || eventData.realizedQualifiedLeads === undefined ? "" : String(eventData.realizedQualifiedLeads),
      dealsClosed: eventData.realizedDealsClosed === null || eventData.realizedDealsClosed === undefined ? "" : String(eventData.realizedDealsClosed),
      generatedRevenue: eventData.realizedRevenue === null || eventData.realizedRevenue === undefined ? "" : String(eventData.realizedRevenue),
      investmentCost: eventData.realizedCost === null || eventData.realizedCost === undefined ? "" : String(eventData.realizedCost),
      notes: String(eventData.realizedNotes || ""),
    });
    setCurrentRealizedRoi(eventData.realizedROI === null || eventData.realizedROI === undefined ? null : Number(eventData.realizedROI));
  };

  const onOutcomeFieldChange = (event) => {
    const { name, value } = event.target;
    setOutcomeError("");
    setOutcomeSuccess("");
    setOutcomeFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const saveOutcome = async (event) => {
    event.preventDefault();
    setOutcomeError("");
    setOutcomeSuccess("");

    if (!canSubmitEvent) {
      setOutcomeError("Open this page from a valid event to save outcome.");
      return;
    }

    const payload = {};
    const collectedLeads = toOptionalNonNegativeNumber(outcomeFormData.collectedLeads);
    const qualifiedLeads = toOptionalNonNegativeNumber(outcomeFormData.qualifiedLeads);
    const dealsClosed = toOptionalNonNegativeNumber(outcomeFormData.dealsClosed);
    const generatedRevenue = toOptionalNonNegativeNumber(outcomeFormData.generatedRevenue);
    const investmentCost = toOptionalNonNegativeNumber(outcomeFormData.investmentCost);
    const notes = String(outcomeFormData.notes || "").trim();

    if (collectedLeads !== null) payload.collectedLeads = collectedLeads;
    if (qualifiedLeads !== null) payload.qualifiedLeads = qualifiedLeads;
    if (dealsClosed !== null) payload.dealsClosed = dealsClosed;
    if (generatedRevenue !== null) payload.generatedRevenue = generatedRevenue;
    if (investmentCost !== null) payload.investmentCost = investmentCost;
    if (notes) payload.notes = notes;

    if (!Object.keys(payload).length) {
      const message = "Add at least one outcome value before saving.";
      setOutcomeError(message);
      window.alert(message);
      return;
    }

    if (!window.confirm("Save these outcome details? You can update them anytime later.")) {
      return;
    }

    setOutcomeSaving(true);
    try {
      const { data } = await API.put(`/events/${eventDetails.eventId}/outcome`, payload);
      applyOutcomeToForm(data || {});
      setRegistrationLocked(Boolean(data?.registrationLocked));
      setOutcomeSuccess("Outcome details saved. This section stays editable.");
    } catch (err) {
      setOutcomeError(err?.response?.data?.message || "Failed to save event outcome");
    } finally {
      setOutcomeSaving(false);
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

      if (isViewOnly) {
        applyRegistrationToForm(state?.registrationData || {});
        setCurrentEventStatus(resolveEventStatus({
          isAttending: state?.isAttending,
          isMissed: state?.isMissed,
          missedReason: state?.missedReason,
        }));
        setCurrentMissedReason(String(state?.missedReason || ""));
        setMissedReasonDraft(String(state?.missedReason || ""));
        return;
      }

      if (!state?.isRegistered) return;

      const fetchKey = String(eventDetails.eventId);
      if (registrationLoadedKeyRef.current === fetchKey) return;
      registrationLoadedKeyRef.current = fetchKey;

      try {
        setLoadingRegistration(true);
        const { data } = await API.get(`/events/${eventDetails.eventId}/my-registration`);
        applyRegistrationToForm(data?.registration || {});
        setCurrentEventStatus(resolveEventStatus(data || {}));
        setCurrentMissedReason(String(data?.missedReason || ""));
        setMissedReasonDraft(String(data?.missedReason || ""));
      } catch (err) {
        if (err?.response?.status !== 404) {
          setError(err?.response?.data?.message || "Failed to load saved registration");
        }
      } finally {
        setLoadingRegistration(false);
      }
    };

    loadSavedRegistration();
  }, [canSubmitEvent, eventDetails.eventId, isViewOnly, state?.isRegistered, state?.registrationData]);

  useEffect(() => {
    const loadEventDetails = async () => {
      if (!canSubmitEvent) return;
      try {
        const { data } = await API.get(`/events/${eventDetails.eventId}`);
        setRegistrationLocked(Boolean(data?.registrationLocked));
        applyOutcomeToForm(data || {});
        setCurrentEventStatus(resolveEventStatus(data || {}));
        setCurrentMissedReason(String(data?.missedReason || ""));
        setMissedReasonDraft(String(data?.missedReason || ""));
      } catch (err) {
        if (err?.response?.status !== 404) {
          setError((prev) => prev || err?.response?.data?.message || "Failed to load event details");
        }
      }
    };
    loadEventDetails();
  }, [canSubmitEvent, eventDetails.eventId]);

  const saveMissedReason = async (event) => {
    event.preventDefault();
    setMissedReasonError("");
    setMissedReasonSuccess("");

    const reason = String(missedReasonDraft || "").trim();
    if (!reason) {
      setMissedReasonError("Missed reason is required.");
      return;
    }

    setMissedReasonSaving(true);
    try {
      const { data } = await API.put(`/events/${eventDetails.eventId}/missed`, { reason });
      const nextReason = String(data?.missedReason || reason);
      setCurrentMissedReason(nextReason);
      setMissedReasonDraft(nextReason);
      setCurrentEventStatus(resolveEventStatus(data || { isMissed: true, missedReason: nextReason }));
      setMissedReasonSuccess("Missed reason updated.");
    } catch (err) {
      setMissedReasonError(err?.response?.data?.message || "Failed to update missed reason.");
    } finally {
      setMissedReasonSaving(false);
    }
  };

  const formatRoiPercent = (value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
    const percent = Number(value) * 100;
    const digits = Math.abs(percent) >= 100 ? 0 : 1;
    return `${percent.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  };

  return (
    <div className="event-registration-page">
      <div className="event-registration-header">
        <div className="event-registration-header-row">
          <h2>Event Registration</h2>
          <button className="back-button" type="button" onClick={() => navigate("/events")}>
            Back to Events
          </button>
        </div>
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
          <p>{formatFee(eventDetails.registrationFee, eventDetails.registrationCurrency)}</p>
        </div>
      </section>

      <section className="event-form-card">
        {!canSubmitEvent && (
          <p className="loading-note">Open this page from an event card to continue.</p>
        )}
        {loadingRegistration && (
          <p className="loading-note">Loading saved registration...</p>
        )}

        <form className="registration-form" onSubmit={onSubmit}>
          {isViewOnly && (
            <p className="loading-note">View-only mode. Admin can review this registration but cannot edit.</p>
          )}
          {registrationLocked && !isViewOnly && (
            <p className="loading-note">Attendance has been marked. Registration details are now locked. Outcome section below remains editable.</p>
          )}
          {registrationSuccess && (
            <p className="success-note">{registrationSuccess}</p>
          )}
          <fieldset className="registration-fieldset" disabled={isViewOnly || submitting || registrationLocked}>
            <section className="form-section">
              <h4 className="section-title">Primary Contact</h4>
              <div className="form-grid">
                <label>
                  Organization Event Manager *
                  <select name="eventManagerUserId" value={formData.eventManagerUserId} onChange={onFieldChange}>
                    <option value="">Select manager</option>
                    {managerUserOptions.map((user) => (
                      <option key={user._id} value={user._id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Participation Role *
                  <select name="participationRole" value={formData.participationRole} onChange={onFieldChange}>
                    <option value="">Select role</option>
                    <option value="Visitor">Visitor</option>
                    <option value="Exhibitor">Exhibitor</option>
                    <option value="Speaker">Speaker</option>
                    <option value="Sponsor">Sponsor</option>
                    <option value="Partner">Partner</option>
                  </select>
                </label>

                <label>
                  Event Website URL *
                  <input
                    type="url"
                    name="eventWebsiteUrl"
                    value={formData.eventWebsiteUrl}
                    onChange={onFieldChange}
                    placeholder="https://..."
                  />
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
                  />
                </label>
              </div>
            </section>

            <section className="form-section">
              <h4 className="section-title">Attendee Selection</h4>
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
                Notes (Optional)
                <textarea
                  name="specialRequirements"
                  rows="3"
                  value={formData.specialRequirements}
                  onChange={onFieldChange}
                  placeholder="Accessibility, seating, or special instructions."
                />
              </label>
            </section>

            <section className="form-section">
              <h4 className="section-title">Payment Details</h4>
              <div className="payment-panel">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    name="isPaymentRequired"
                    checked={Boolean(formData.isPaymentRequired)}
                    onChange={onFieldChange}
                  />
                  Is payment required for this event registration?
                </label>

                {formData.isPaymentRequired && (
                  <>
                    <div className="form-grid">
                      <label>
                        Payment Method *
                        <select name="paymentMethod" value={formData.paymentMethod} onChange={onFieldChange}>
                          <option value="UPI">UPI</option>
                          <option value="Credit Card">Credit Card</option>
                          <option value="Debit Card">Debit Card</option>
                          <option value="Net Banking">Net Banking</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                        </select>
                      </label>

                      <label>
                        Amount Paid ({eventDetails.registrationCurrency || "INR"}) *
                        <input
                          type="number"
                          min="0"
                          name="amountPaid"
                          value={formData.amountPaid}
                          onChange={onFieldChange}
                          placeholder={String(eventDetails.registrationFee)}
                        />
                      </label>

                      <label>
                        Payment Date *
                        <input type="date" name="paymentDate" value={formData.paymentDate} onChange={onFieldChange} />
                      </label>

                      <label>
                        Reference No *
                        <input
                          type="text"
                          name="paymentReferenceNo"
                          value={formData.paymentReferenceNo}
                          onChange={onFieldChange}
                          placeholder="UTR / Transaction ID"
                        />
                      </label>

                      <label>
                        Payment Screenshot *
                        <input type="file" accept="image/*" onChange={handlePaymentScreenshotChange} />
                        {hasSavedPaymentScreenshot && !formData.paymentScreenshot && (
                          <small className="field-help-text">Existing screenshot is already saved. Upload only if you want to replace it.</small>
                        )}
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
                  </>
                )}
                {!formData.isPaymentRequired && (
                  <small className="field-help-text">Payment details are skipped for this registration.</small>
                )}
              </div>
            </section>

            <section className="form-section">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="agreeTerms"
                  checked={formData.agreeTerms}
                  onChange={onFieldChange}
                />
                I agree to the event terms and registration policy.
              </label>

              <FormErrorSlot message={error} className="form-error-slot-global" />

              <div className="submit-row">
                {!isViewOnly && (
                  <button className="submit-btn" type="submit" disabled={submitting || !canSubmitEvent || registrationLocked}>
                    {submitting ? "Saving..." : "Save Registration"}
                  </button>
                )}
              </div>
            </section>
          </fieldset>
        </form>
      </section>

      {currentEventStatus === "attended" && (
        <section className="event-form-card">
          <form className="registration-form" onSubmit={saveOutcome}>
            <section className="form-section">
              <h4 className="section-title">Outcome Details</h4>
              <p className="section-note">
                This section stays editable forever, even after attendance is marked. Add at least one value or note to save.
              </p>
              <div className="form-grid">
                <label>
                  Collected Leads
                  <input
                    type="number"
                    name="collectedLeads"
                    min="0"
                    value={outcomeFormData.collectedLeads}
                    onChange={onOutcomeFieldChange}
                  />
                </label>

                <label>
                  Qualified Leads
                  <input
                    type="number"
                    name="qualifiedLeads"
                    min="0"
                    value={outcomeFormData.qualifiedLeads}
                    onChange={onOutcomeFieldChange}
                  />
                </label>

                <label>
                  Deals Closed
                  <input
                    type="number"
                    name="dealsClosed"
                    min="0"
                    value={outcomeFormData.dealsClosed}
                    onChange={onOutcomeFieldChange}
                  />
                </label>

                <label>
                  Generated Revenue ({eventDetails.registrationCurrency || "INR"})
                  <input
                    type="number"
                    name="generatedRevenue"
                    min="0"
                    value={outcomeFormData.generatedRevenue}
                    onChange={onOutcomeFieldChange}
                  />
                </label>

                <label>
                  Investment Cost ({eventDetails.registrationCurrency || "INR"})
                  <input
                    type="number"
                    name="investmentCost"
                    min="0"
                    value={outcomeFormData.investmentCost}
                    onChange={onOutcomeFieldChange}
                  />
                </label>

                <label>
                  Realized ROI
                  <input type="text" value={formatRoiPercent(currentRealizedRoi)} readOnly />
                </label>
              </div>

              <label className="full-width">
                Outcome Notes
                <textarea
                  name="notes"
                  rows="3"
                  value={outcomeFormData.notes}
                  onChange={onOutcomeFieldChange}
                  placeholder="Optional remarks about the event outcome"
                />
              </label>

              <FormErrorSlot message={outcomeError} className="form-error-slot-global" />
              {outcomeSuccess && <p className="success-note">{outcomeSuccess}</p>}

              <div className="submit-row">
                <button className="submit-btn" type="submit" disabled={outcomeSaving || !canSubmitEvent}>
                  {outcomeSaving ? "Saving..." : "Save Outcome"}
                </button>
              </div>
            </section>
          </form>
        </section>
      )}

      {currentEventStatus === "missed" && (
        <section className="event-form-card">
          <form className="registration-form" onSubmit={saveMissedReason}>
            <section className="form-section">
            <h4 className="section-title">Outcome Details</h4>
            <p className="section-note">
              This event is marked as missed. You can update the missed reason from here.
            </p>
            <label className="full-width">
              Missed Reason
              <textarea
                rows="4"
                value={missedReasonDraft}
                onChange={(event) => {
                  setMissedReasonDraft(event.target.value);
                  setMissedReasonError("");
                  setMissedReasonSuccess("");
                }}
                placeholder="Why was this event missed?"
              />
            </label>
            <div className="event-missed-reason-display">
              <strong>Current reason:</strong>{" "}
              {String(currentMissedReason || "").trim() || "No reason captured."}
            </div>

            <FormErrorSlot message={missedReasonError} className="form-error-slot-global" />
            {missedReasonSuccess && <p className="success-note">{missedReasonSuccess}</p>}

            <div className="submit-row">
              <button className="submit-btn" type="submit" disabled={missedReasonSaving || !canSubmitEvent}>
                {missedReasonSaving ? "Saving..." : "Save Missed Reason"}
              </button>
            </div>
            </section>
          </form>
        </section>
      )}

      <ConfirmDialog
        isOpen={registrationConfirmOpen}
        title="Confirm Registration"
        message="Confirm registration submission? Once attendance is marked later, attendee details cannot be changed."
        confirmText="Submit Registration"
        cancelText="Cancel"
        onConfirm={submitRegistration}
        onCancel={() => setRegistrationConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={registrationSavedPopupOpen}
        title="Registration Saved"
        message="Event registered successfully. Redirecting to Events page."
        confirmText="Go to Events"
        hideCancel={true}
        onConfirm={() => {
          setRegistrationSavedPopupOpen(false);
          navigate("/events");
        }}
        onCancel={() => {
          setRegistrationSavedPopupOpen(false);
          navigate("/events");
        }}
      />
    </div>
  );
};

export default EventRegistration;
