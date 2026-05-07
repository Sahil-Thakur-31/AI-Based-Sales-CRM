const LEAD_PERIOD_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const SALES_PERIOD_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const SALES_MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const SALES_QUARTER_OPTIONS = [
  { value: "q1", label: "Q1 (Jan-Mar)" },
  { value: "q2", label: "Q2 (Apr-Jun)" },
  { value: "q3", label: "Q3 (Jul-Sep)" },
  { value: "q4", label: "Q4 (Oct-Dec)" },
];

function sanitizeYearInput(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function ReportsHeader({
  activeType,
  setActiveType,
  salesFilters,
  setSalesFilters,
  salesUsers,
  canUseAllSalesUsers,
  salesAllOptionLabel,
  leadsPeriod,
  setLeadsPeriod,
  reportTypes,
}) {
  const showSalesFilters = activeType === "sales";
  const showLeadsFilter = activeType === "leads";
  const showSalesUserFilter = canUseAllSalesUsers || salesUsers.length > 1;

  return (
    <div className="report-header">
      <div className="report-type-row">
        {reportTypes.map((type) => (
          <button
            key={type.key}
            className={`report-type-btn ${
              activeType === type.key ? "active" : ""
            }`}
            onClick={() => setActiveType(type.key)}
          >
            {type.label}
          </button>
        ))}
      </div>

      {showSalesFilters && (
        <div className="report-filter-row">
          <select
            className="report-filter"
            value={salesFilters.period}
            onChange={(event) =>
              setSalesFilters((current) => ({
                ...current,
                period: event.target.value,
              }))
            }
          >
            {SALES_PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {salesFilters.period === "monthly" && (
            <select
              className="report-filter"
              value={salesFilters.month}
              onChange={(event) =>
                setSalesFilters((current) => ({
                  ...current,
                  month: event.target.value,
                }))
              }
            >
              {SALES_MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {salesFilters.period === "quarterly" && (
            <select
              className="report-filter"
              value={salesFilters.quarter}
              onChange={(event) =>
                setSalesFilters((current) => ({
                  ...current,
                  quarter: event.target.value,
                }))
              }
            >
              {SALES_QUARTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          <input
            className="report-filter report-filter-input"
            type="text"
            inputMode="numeric"
            placeholder="Year"
            value={salesFilters.year}
            onChange={(event) =>
              setSalesFilters((current) => ({
                ...current,
                year: sanitizeYearInput(event.target.value),
              }))
            }
          />

          {showSalesUserFilter && (
            <select
              className="report-filter"
              value={salesFilters.assignedTo}
              onChange={(event) =>
                setSalesFilters((current) => ({
                  ...current,
                  assignedTo: event.target.value,
                }))
              }
            >
              {canUseAllSalesUsers && <option value="all">{salesAllOptionLabel || "All Users"}</option>}
              {salesUsers.map((user) => (
                <option key={user._id} value={user._id}>
                  {`${user.name || user.email || "User"} - ${user.roleName || "user"}`}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {showLeadsFilter && (
        <select
          className="report-filter"
          value={leadsPeriod}
          onChange={(event) => setLeadsPeriod(event.target.value)}
        >
          {LEAD_PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default ReportsHeader;
