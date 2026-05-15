import "../styles/dashboardDateFilter.css";

const DEFAULT_PERIOD_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" }
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index,
  label: new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" })
}));

const QUARTER_OPTIONS = [
  { value: "q1", label: "Q1 (Jan-Mar)" },
  { value: "q2", label: "Q2 (Apr-Jun)" },
  { value: "q3", label: "Q3 (Jul-Sep)" },
  { value: "q4", label: "Q4 (Oct-Dec)" }
];

function sanitizeYearInput(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function clampYearInput(value) {
  const sanitized = sanitizeYearInput(value);
  if (!sanitized) return "";
  const numeric = Number.parseInt(sanitized, 10);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.min(2060, Math.max(2020, numeric)));
}

function DashboardDateFilter({
  period = "month",
  periodOptions = DEFAULT_PERIOD_OPTIONS,
  month,
  quarter = "q1",
  year,
  onPeriodChange,
  onMonthChange,
  onQuarterChange,
  onYearChange,
  disabled = false,
  className = ""
}) {
  const yearValue = String(year ?? "");
  const showMonthFilter = period === "monthly";
  const showQuarterFilter = period === "quarterly";

  return (
    <div className={`dashboard-report-filter-row ${className}`.trim()}>
      <select
        className="dashboard-report-filter"
        value={period}
        onChange={(event) => onPeriodChange?.(event.target.value)}
        disabled={disabled}
      >
        {periodOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {showMonthFilter ? (
        <select
          className="dashboard-report-filter"
          value={month}
          onChange={(event) => onMonthChange?.(Number(event.target.value))}
          disabled={disabled}
        >
          {MONTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {showQuarterFilter ? (
        <select
          className="dashboard-report-filter"
          value={quarter}
          onChange={(event) => onQuarterChange?.(event.target.value)}
          disabled={disabled}
        >
          {QUARTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      <input
        className="dashboard-report-filter dashboard-report-filter-input"
        type="text"
        inputMode="numeric"
        placeholder="Year"
        value={yearValue}
        onChange={(event) => onYearChange?.(sanitizeYearInput(event.target.value))}
        onBlur={(event) => onYearChange?.(clampYearInput(event.target.value) || yearValue)}
        disabled={disabled}
      />
    </div>
  );
}

export default DashboardDateFilter;
