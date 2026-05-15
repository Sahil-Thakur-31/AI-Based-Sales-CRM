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

function clampYearInput(value) {
  const sanitized = sanitizeYearInput(value);
  if (!sanitized) return "";
  const numeric = Number.parseInt(sanitized, 10);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.min(2060, Math.max(2020, numeric)));
}

function ReportsHeader({
  activeType,
  setActiveType,
  salesFilters,
  setSalesFilters,
  salesUsers,
  canUseAllSalesUsers,
  salesAllOptionLabel,
  leadsFilters,
  setLeadsFilters,
  expenseFilters,
  setExpenseFilters,
  reportTypes,
  onExportPdf,
}) {
  const showSalesFilters = activeType === "sales";
  const showLeadsFilters = activeType === "leads";
  const showExpenseFilters = activeType === "expense";
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

      <div className="report-header-controls">
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
              onBlur={(event) =>
                setSalesFilters((current) => ({
                  ...current,
                  year: clampYearInput(event.target.value) || current.year,
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

        {showLeadsFilters && (
          <div className="report-filter-row">
            <select
              className="report-filter"
              value={leadsFilters.period}
              onChange={(event) =>
                setLeadsFilters((current) => ({
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

            {leadsFilters.period === "monthly" && (
              <select
                className="report-filter"
                value={leadsFilters.month}
                onChange={(event) =>
                  setLeadsFilters((current) => ({
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

            {leadsFilters.period === "quarterly" && (
              <select
                className="report-filter"
                value={leadsFilters.quarter}
                onChange={(event) =>
                  setLeadsFilters((current) => ({
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
              value={leadsFilters.year}
              onChange={(event) =>
                setLeadsFilters((current) => ({
                  ...current,
                  year: sanitizeYearInput(event.target.value),
                }))
              }
              onBlur={(event) =>
                setLeadsFilters((current) => ({
                  ...current,
                  year: clampYearInput(event.target.value) || current.year,
                }))
              }
            />
          </div>
        )}

        {showExpenseFilters && (
          <div className="report-filter-row">
            <select
              className="report-filter"
              value={expenseFilters.period}
              onChange={(event) =>
                setExpenseFilters((current) => ({
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

            {expenseFilters.period === "monthly" && (
              <select
                className="report-filter"
                value={expenseFilters.month}
                onChange={(event) =>
                  setExpenseFilters((current) => ({
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

            {expenseFilters.period === "quarterly" && (
              <select
                className="report-filter"
                value={expenseFilters.quarter}
                onChange={(event) =>
                  setExpenseFilters((current) => ({
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
              value={expenseFilters.year}
              onChange={(event) =>
                setExpenseFilters((current) => ({
                  ...current,
                  year: sanitizeYearInput(event.target.value),
                }))
              }
              onBlur={(event) =>
                setExpenseFilters((current) => ({
                  ...current,
                  year: clampYearInput(event.target.value) || current.year,
                }))
              }
            />
          </div>
        )}

        <div className="report-actions-row">
          <button
            type="button"
            className="report-export-btn"
            onClick={onExportPdf}
          >
            <i className="bi bi-file-earmark-pdf" aria-hidden="true" />
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportsHeader;
