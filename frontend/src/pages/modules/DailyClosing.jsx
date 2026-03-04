import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../styles/DailyClosing.css";

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCalendarDays(viewDate, today) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDayIndex = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startDayIndex);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      date,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
      isFuture: date > today,
      isToday: isSameDay(date, today),
    };
  });
}

export default function DailyClosing() {
  const navigate = useNavigate();
  const location = useLocation();
  const today = useMemo(() => getToday(), []);
  const initialDate = useMemo(() => {
    const fromState = parseLocalDateInput(location.state?.selectedDate);
    if (fromState && fromState <= today) return fromState;
    return today;
  }, [location.state?.selectedDate, today]);
  const [viewDate, setViewDate] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedTime, setSelectedTime] = useState(getCurrentTimeValue);

  const calendarDays = useMemo(
    () => buildCalendarDays(viewDate, today),
    [today, viewDate]
  );

  const monthLabel = useMemo(
    () =>
      viewDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
    [viewDate]
  );

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

  const maxAllowedTime = isSameDay(selectedDate, today)
    ? getCurrentTimeValue()
    : undefined;

  const canGoToNextMonth =
    viewDate.getFullYear() < today.getFullYear() ||
    (viewDate.getFullYear() === today.getFullYear() &&
      viewDate.getMonth() < today.getMonth());

  const canGoToNextYear = viewDate.getFullYear() < today.getFullYear();

  const moveMonth = (offset) => {
    const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
    if (next > new Date(today.getFullYear(), today.getMonth(), 1)) return;
    setViewDate(next);
  };

  const moveYear = (offset) => {
    const next = new Date(viewDate.getFullYear() + offset, viewDate.getMonth(), 1);
    if (next > new Date(today.getFullYear(), today.getMonth(), 1)) return;
    setViewDate(next);
  };

  const goToToday = () => {
    setViewDate(today);
    setSelectedDate(today);
    setSelectedTime(getCurrentTimeValue());
  };

  const openClosingForm = () => {
    navigate("/daily-closing/form", {
      state: {
        selectedDate: formatLocalDateInput(selectedDate),
        selectedTime,
      },
    });
  };

  useEffect(() => {
    if (!isSameDay(selectedDate, today)) return;

    setSelectedTime(getCurrentTimeValue());

    const intervalId = window.setInterval(() => {
      setSelectedTime(getCurrentTimeValue());
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, [selectedDate, today]);

  return (
    <div className="dailyClosingPage">
      <div className="dailyClosingHero">
        <div>
          <p className="dailyClosingEyebrow">Daily Closing</p>
          <h1 className="dailyClosingTitle">Calendar</h1>
          <p className="dailyClosingSubtitle">
            Choose today or any past date, then set the closing time for the record.
          </p>
        </div>

        <div className="dailyClosingSummaryCard">
          <span className="dailyClosingSummaryLabel">Selected</span>
          <strong>{selectedLabel}</strong>
          <span className="dailyClosingSummaryTime">{selectedTime}</span>
        </div>
      </div>

      <div className="dailyClosingLayout">
        <section className="dailyClosingCalendarCard">
          <div className="dailyClosingToolbar">
            <div className="dailyClosingToolbarGroup">
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnGhost"
                onClick={() => moveYear(-1)}
              >
                Prev Year
              </button>
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnIcon"
                onClick={() => moveMonth(-1)}
              >
                {"<"}
              </button>
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnPrimary"
                onClick={goToToday}
              >
                Today
              </button>
            </div>

            <h2 className="dailyClosingMonth">{monthLabel}</h2>

            <div className="dailyClosingToolbarGroup">
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnIcon"
                onClick={() => moveMonth(1)}
                disabled={!canGoToNextMonth}
              >
                {">"}
              </button>
              <button
                type="button"
                className="dailyClosingBtn dailyClosingBtnGhost"
                onClick={() => moveYear(1)}
                disabled={!canGoToNextYear}
              >
                Next Year
              </button>
            </div>
          </div>

          <div className="dailyClosingWeekHeader">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="dailyClosingWeekCell">
                {day}
              </div>
            ))}
          </div>

          <div className="dailyClosingGrid">
            {calendarDays.map((item) => {
              const isSelected = isSameDay(item.date, selectedDate);

              return (
                <button
                  key={item.key}
                  type="button"
                  className={[
                    "dailyClosingDay",
                    item.isCurrentMonth ? "" : "isOutsideMonth",
                    item.isFuture ? "isDisabled" : "",
                    item.isToday ? "isToday" : "",
                    isSelected ? "isSelected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    if (item.isFuture) return;
                    setSelectedDate(item.date);
                    if (isSameDay(item.date, today)) {
                      setSelectedTime(getCurrentTimeValue());
                    }
                  }}
                  disabled={item.isFuture}
                >
                  <span className="dailyClosingDayNumber">{item.dayNumber}</span>
                  {item.isToday ? (
                    <span className="dailyClosingDayTag">Today</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="dailyClosingSideCard">
          <div className="dailyClosingFieldBlock">
            <label className="dailyClosingLabel" htmlFor="daily-closing-date">
              Closing Date
            </label>
            <input
              id="daily-closing-date"
              className="dailyClosingInput"
              type="date"
              value={formatLocalDateInput(selectedDate)}
              max={formatLocalDateInput(today)}
              onChange={(e) => {
                const next = new Date(`${e.target.value}T00:00:00`);
                if (Number.isNaN(next.getTime()) || next > today) return;
                setSelectedDate(next);
                setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
                if (isSameDay(next, today)) {
                  setSelectedTime(getCurrentTimeValue());
                }
              }}
            />
          </div>

          <div className="dailyClosingFieldBlock">
            <label className="dailyClosingLabel" htmlFor="daily-closing-time">
              Closing Time
            </label>
            <input
              id="daily-closing-time"
              className="dailyClosingInput"
              type="time"
              value={selectedTime}
              max={maxAllowedTime}
              onChange={(e) => {
                const nextTime = e.target.value;
                if (maxAllowedTime && nextTime > maxAllowedTime) return;
                setSelectedTime(nextTime);
              }}
            />
          </div>

          <div className="dailyClosingInfoCard">
            <span className="dailyClosingInfoLabel">Ready For Entry</span>
            <h3>{selectedLabel}</h3>
            <p>
              Future dates are locked. Pick any earlier date or today and proceed with
              the daily closing flow.
            </p>
            <button
              type="button"
              className="dailyClosingBtn dailyClosingBtnPrimary dailyClosingOpenBtn"
              onClick={openClosingForm}
            >
              Open Daily Closing Form
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
