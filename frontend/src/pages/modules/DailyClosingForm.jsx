import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
import { minLength } from "../../utils/formValidation";
import "../../styles/DailyClosing.css";

function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatLocalDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${date.getFullYear()}`;
}

function parseLocalDateInput(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export default function DailyClosingForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const today = useMemo(() => getToday(), []);
  const selectedDate = useMemo(() => {
    const fromState = parseLocalDateInput(location.state?.selectedDate);
    if (fromState && fromState <= today) return fromState;
    return today;
  }, [location.state?.selectedDate, today]);
  const [keyHighlights, setKeyHighlights] = useState(
    String(location.state?.keyHighlights || "")
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const selectedLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [selectedDate]
  );

  const selectedDisplayDate = useMemo(
    () => formatDisplayDate(selectedDate),
    [selectedDate]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    const highlightsError = minLength(keyHighlights, 3, "Key highlights");
    if (highlightsError) {
      setSubmitError(highlightsError);
      return;
    }
    try {
      setIsSubmitting(true);
      setSubmitError("");

      const selectedDateValue = formatLocalDateInput(selectedDate);
      const keyHighlightsValue = keyHighlights.trim();

      await API.post("/daily-closing/submit", {
        selectedDate: selectedDateValue,
        keyHighlights: keyHighlightsValue,
      });

      navigate("/daily-closing/report", {
        state: {
          selectedDate: selectedDateValue,
          keyHighlights: keyHighlightsValue,
        },
      });
    } catch (error) {
      console.error("Daily closing submit failed:", error);
      setSubmitError(
        error?.response?.data?.message || "Failed to submit daily closing report"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    navigate("/calendar", {
      state: {
        selectedDate: formatLocalDateInput(selectedDate),
      },
    });
  };

  return (
    <div className="dailyClosingPage">
      <section className="dailyClosingFormSection dailyClosingFormSectionStandalone">
        <div className="dailyClosingFormHeader">
          <div>
            <p className="dailyClosingEyebrow">Daily Closing</p>
          </div>
          <div className="dailyClosingFormMeta">
            <span>{selectedLabel}</span>
          </div>
        </div>

        <form className="dailyClosingFormCard" onSubmit={handleSubmit}>
          <div className="dailyClosingFormBody">
            <div className="dailyClosingFormRow">
              <label className="dailyClosingFormLabel" htmlFor="daily-closing-form-date">
                Daily Closing Date <span>*</span>
              </label>
              <input
                id="daily-closing-form-date"
                className="dailyClosingInput"
                type="text"
                value={selectedDisplayDate}
                readOnly
              />
            </div>

            <div className="dailyClosingFormRow dailyClosingFormRowTop">
              <label
                className="dailyClosingFormLabel"
                htmlFor="daily-closing-key-highlights"
              >
                Key Highlights Of The Day <span>*</span>
              </label>
              <textarea
                id="daily-closing-key-highlights"
                className="dailyClosingTextarea"
                placeholder="Enter key highlights of the day..."
                value={keyHighlights}
                onChange={(e) => setKeyHighlights(e.target.value)}
              />
            </div>

            <FormErrorSlot message={submitError} className="form-error-slot-global" />

            <div className="dailyClosingFormActions">
              <button
                type="submit"
                className="dailyClosingBtn dailyClosingBtnSuccess"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit & View Report"}
              </button>
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnGhost"
                onClick={handleBack}
              >
                Back to Main Calendar
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
