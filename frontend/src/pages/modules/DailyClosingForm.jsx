import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../styles/DailyClosing.css";

function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getCurrentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
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
  const selectedTime = location.state?.selectedTime || getCurrentTimeValue();
  const [keyHighlights, setKeyHighlights] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");

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

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitMessage("Daily closing captured locally. Backend save can be connected next.");
  };

  const handleBack = () => {
    navigate("/daily-closing", {
      state: {
        selectedDate: formatLocalDateInput(selectedDate),
        selectedTime,
      },
    });
  };

  return (
    <div className="dailyClosingPage">
      <section className="dailyClosingFormSection dailyClosingFormSectionStandalone">
        <div className="dailyClosingFormHeader">
          <div>
            <p className="dailyClosingEyebrow">Daily Closing</p>
            <h2 className="dailyClosingFormTitle">
              Daily Closing - {selectedDisplayDate}
            </h2>
          </div>
          <div className="dailyClosingFormMeta">
            <span>{selectedLabel}</span>
            <strong>{selectedTime}</strong>
          </div>
        </div>

        <form className="dailyClosingFormCard" onSubmit={handleSubmit}>
          <div className="dailyClosingFormRibbon">Daily Closing</div>

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

            <div className="dailyClosingFormRow">
              <label className="dailyClosingFormLabel" htmlFor="daily-closing-form-time">
                Closing Time <span>*</span>
              </label>
              <input
                id="daily-closing-form-time"
                className="dailyClosingInput"
                type="text"
                value={selectedTime}
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
                required
              />
            </div>

            <div className="dailyClosingFormActions">
              <button
                type="submit"
                className="dailyClosingBtn dailyClosingBtnSuccess"
              >
                Submit & View Report
              </button>
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnGhost"
                onClick={handleBack}
              >
                Back to Calendar
              </button>
            </div>

            {submitMessage ? (
              <div className="dailyClosingSubmitMessage">{submitMessage}</div>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
