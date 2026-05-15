import React, { useEffect, useState } from "react";
import API from "../../../api";

const MONTH_LABELS = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function escapeCsvValue(value) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function toCategoryLabel(value) {
  return String(value || "other")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function matchesExpenseTableFilter(row, filterValue) {
  const category = String(row.category || "").toLowerCase();
  const referenceType = String(row.referenceType || "").toLowerCase();

  switch (filterValue) {
    case "pending":
    case "approved":
    case "rejected":
      return String(row.approvalStatus || "").toLowerCase() === filterValue;
    case "travel":
    case "food":
    case "hotel":
    case "stationery":
    case "client_meeting":
    case "other":
    case "marketing":
      return category === filterValue;
    case "lead":
    case "deal":
    case "event/expos":
      return referenceType === filterValue;
    case "event":
      return category === "event" || referenceType === "event";
    default:
      return true;
  }
}

function buildReportParams(filters = {}) {
  const params = {
    period: filters.period || "monthly",
    year: filters.year || String(new Date().getFullYear()),
  };

  if (params.period === "monthly") {
    params.month = filters.month || String(new Date().getMonth() + 1);
  }

  if (params.period === "quarterly") {
    params.quarter = filters.quarter || "q1";
  }

  return params;
}

function normalizeSearchValue(value) {
  return String(value ?? "").toLowerCase().trim();
}

function matchesExpenseSearch(row, searchValue) {
  const query = normalizeSearchValue(searchValue);
  if (!query) return true;

  const haystack = [
    row.expenseNo,
    row.vendorName,
    row.categoryLabel,
    row.referenceType,
    row.totalAmount,
    row.gstAmount,
    row.approvalStatus,
    row.userName,
    row.description,
    formatDate(row.expenseDate),
  ]
    .map(normalizeSearchValue)
    .join(" ");

  return haystack.includes(query);
}

function formatReportPeriod(params = {}) {
  const year = String(params.year || "").trim();
  if (params.period === "quarterly") {
    const quarterLabel = String(params.quarter || "q1").toUpperCase();
    return `${quarterLabel} ${year}`.trim();
  }

  if (params.period === "yearly") {
    return year || "this year";
  }

  const monthLabel = MONTH_LABELS[Number(params.month)] || "Selected month";
  return `${monthLabel} ${year}`.trim();
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describePieSlice(centerX, centerY, radius, startAngle, endAngle) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    centerX,
    centerY,
    "L",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "Z",
  ].join(" ");
}

function formatSharePercent(value, total) {
  const numerator = Number(value || 0);
  const denominator = Number(total || 0);
  if (denominator <= 0 || numerator <= 0) return "0.0";

  const percent = (numerator / denominator) * 100;
  if (percent < 0.1) return "<0.1";
  return percent.toFixed(1);
}

function buildExpenseKpiCards(expenses, loading, error) {
  if (loading) {
    return [
      { key: "total", value: "Loading...", label: "Total Expense", meta: "Fetching live expense data", tone: "neutral" },
      { key: "approved", value: "Loading...", label: "Approved", meta: "Fetching live expense data", tone: "neutral" },
      { key: "pending", value: "Loading...", label: "Pending", meta: "Fetching live expense data", tone: "neutral" },
      { key: "average", value: "Loading...", label: "Avg Expense", meta: "Fetching live expense data", tone: "neutral" },
      { key: "rejected", value: "Loading...", label: "Rejected", meta: "Fetching live expense data", tone: "neutral" },
    ];
  }

  if (error) {
    return [
      { key: "total", value: "--", label: "Total Expense", meta: "Unable to load expense data", tone: "warning" },
      { key: "approved", value: "--", label: "Approved", meta: "Unable to load expense data", tone: "warning" },
      { key: "pending", value: "--", label: "Pending", meta: "Unable to load expense data", tone: "warning" },
      { key: "average", value: "--", label: "Avg Expense", meta: "Unable to load expense data", tone: "warning" },
      { key: "rejected", value: "--", label: "Rejected", meta: "Unable to load expense data", tone: "warning" },
    ];
  }

  const totalAmount = expenses.reduce((sum, expense) => sum + Number(expense.totalAmount || 0), 0);
  const approvedAmount = expenses
    .filter((expense) => String(expense.approval?.status || "pending").toLowerCase() === "approved")
    .reduce((sum, expense) => sum + Number(expense.totalAmount || 0), 0);
  const pendingCount = expenses.filter(
    (expense) => String(expense.approval?.status || "pending").toLowerCase() === "pending"
  ).length;
  const rejectedCount = expenses.filter(
    (expense) => String(expense.approval?.status || "pending").toLowerCase() === "rejected"
  ).length;
  const averageAmount = expenses.length ? totalAmount / expenses.length : 0;

  return [
    { key: "total", value: formatCurrency(totalAmount), label: "Total Expense", meta: `${expenses.length} records`, tone: "neutral" },
    { key: "approved", value: formatCurrency(approvedAmount), label: "Approved", meta: "Approved spend", tone: "positive" },
    { key: "pending", value: String(pendingCount), label: "Pending", meta: "Awaiting approval", tone: pendingCount > 0 ? "warning" : "neutral" },
    { key: "average", value: formatCurrency(averageAmount), label: "Avg Expense", meta: "Average per entry", tone: "neutral" },
    { key: "rejected", value: String(rejectedCount), label: "Rejected", meta: "Rejected entries", tone: rejectedCount > 0 ? "warning" : "neutral" },
  ];
}

function ExpenseTab({ filters }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableFilter, setTableFilter] = useState("all");
  const [tableSearch, setTableSearch] = useState("");
  const [scopeLabel, setScopeLabel] = useState("");
  const reportParams = buildReportParams(filters);
  const reportKey = [reportParams.period, reportParams.month || "", reportParams.quarter || "", reportParams.year].join("-");
  const periodLabel = formatReportPeriod(reportParams);

  useEffect(() => {
    let isMounted = true;

    async function loadExpenses() {
      setLoading(true);
      setError("");
      try {
        const res = await API.get("/api/expenses/reports/analytics", { params: reportParams });
        if (!isMounted) return;
        const payload = res.data || {};
        setExpenses(Array.isArray(payload.expenses) ? payload.expenses : []);
        setScopeLabel(String(payload.scopeLabel || ""));
      } catch (err) {
        if (!isMounted) return;
        console.error("Failed to load expense analytics:", err);
        setError("Failed to load expenses");
        setExpenses([]);
        setScopeLabel("");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadExpenses();
    return () => {
      isMounted = false;
    };
  }, [reportKey]);

  const kpiCards = buildExpenseKpiCards(expenses, loading, error);
  const expenseRows = expenses.map((expense) => ({
    id: String(expense?._id || ""),
    expenseNo: expense?.expenseNo || "",
    vendorName: expense?.vendorName || expense?.receipt?.extractedData?.vendor || "Unknown Vendor",
    category: String(expense?.category || "other"),
    categoryLabel: toCategoryLabel(expense?.category),
    referenceType: String(expense?.referenceType || ""),
    totalAmount: Number(expense?.totalAmount || 0),
    baseAmount: Number(expense?.amount || 0),
    gstAmount: Number(expense?.gstAmount || 0),
    expenseDate: expense?.expenseDate || null,
    approvalStatus: String(expense?.approval?.status || "pending"),
    userName: expense?.userId?.name || expense?.userId?.email || "User",
    description: expense?.description || "",
  }));
  const filteredExpenseRows = expenseRows.filter(
    (row) => matchesExpenseTableFilter(row, tableFilter) && matchesExpenseSearch(row, tableSearch)
  );

  const breakdownMap = expenseRows.reduce((acc, row) => {
    const key = row.category || "other";
    acc.set(key, (acc.get(key) || 0) + row.totalAmount);
    return acc;
  }, new Map());
  const breakdownRows = [...breakdownMap.entries()]
    .map(([key, amount]) => ({ key, label: toCategoryLabel(key), amount }))
    .sort((a, b) => b.amount - a.amount);
  const totalBreakdown = breakdownRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pieColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

  const approvalCounts = expenseRows.reduce(
    (acc, row) => {
      const status = String(row.approvalStatus || "pending").toLowerCase();
      if (status === "approved") acc.approved += 1;
      else if (status === "rejected") acc.rejected += 1;
      else acc.pending += 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0 }
  );

  const trendMap = expenseRows.reduce((acc, row) => {
    const date = row.expenseDate ? new Date(row.expenseDate) : null;
    if (!date || Number.isNaN(date.getTime())) return acc;
    const label = `${date.getDate()} ${date.toLocaleDateString("en-GB", { month: "short" })}`;
    acc.set(label, (acc.get(label) || 0) + row.totalAmount);
    return acc;
  }, new Map());
  const expenseTrend = [...trendMap.entries()].map(([label, total]) => ({ label, total }));
  const noExpensesMessage = scopeLabel
    ? `No expenses found for ${periodLabel}. Scope: ${scopeLabel}.`
    : `No expenses found for ${periodLabel}.`;

  function handleExportExcel() {
    const headers = [
      "Expense No",
      "Date",
      "Vendor",
      "Category",
      "Reference Type",
      "Total Amount",
      "Base Amount",
      "GST Amount",
      "Approval Status",
      "User",
      "Description",
    ];

    const csvRows = filteredExpenseRows.map((row) => [
      row.expenseNo,
      formatDate(row.expenseDate),
      row.vendorName,
      row.categoryLabel,
      row.referenceType || "--",
      formatCurrency(row.totalAmount),
      formatCurrency(row.baseAmount),
      formatCurrency(row.gstAmount),
      row.approvalStatus,
      row.userName,
      row.description || "",
    ]);

    const csvContent = [
      headers.map(escapeCsvValue).join(","),
      ...csvRows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expense-report-${reportKey}-${tableFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="expense-tab">
      <section className="kpi-grid">
        {kpiCards.map((card) => (
          <div key={card.key} className={`kpi-card ${card.tone}`}>
            <div className="kpi-value">{card.value}</div>
            <span>{card.label}</span>
            <div className="kpi-meta">{card.meta}</div>
          </div>
        ))}
      </section>

      <section className="reports-card">
        <h2 className="reports-card-title">Expense Trend</h2>
        {expenseTrend.length === 0 ? (
          <div className="chart-box" style={{ color: "#9ca3af" }}>{loading ? "Loading..." : noExpensesMessage}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {expenseTrend.map((item) => (
              <div key={item.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 110px", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#475569" }}>{item.label}</span>
                <div style={{ background: "#e2e8f0", borderRadius: 999, height: 10 }}>
                  <div
                    style={{
                      width: `${Math.max(6, (item.total / Math.max(...expenseTrend.map((row) => row.total), 1)) * 100)}%`,
                      background: "#0f766e",
                      borderRadius: 999,
                      height: "100%",
                    }}
                  />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#334155", textAlign: "right" }}>{formatCurrency(item.total)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        <section className="reports-card">
          <h2 className="reports-card-title">Expense Breakdown</h2>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) 1fr", gap: 20, alignItems: "center", marginTop: 16 }}>
            {breakdownRows.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>{loading ? "Loading..." : noExpensesMessage}</p>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <svg width="240" height="240" viewBox="0 0 240 240" aria-label="Expense breakdown pie chart">
                    <circle cx="120" cy="120" r="92" fill="#f8fafc" />
                    {(() => {
                      let currentAngle = 0;
                      return breakdownRows.map((row, index) => {
                        const sliceAngle = totalBreakdown > 0 ? (Number(row.amount || 0) / totalBreakdown) * 360 : 0;
                        const startAngle = currentAngle;
                        const endAngle = currentAngle + sliceAngle;
                        currentAngle = endAngle;
                        return (
                          <path
                            key={row.key}
                            d={describePieSlice(120, 120, 92, startAngle, endAngle)}
                            fill={pieColors[index % pieColors.length]}
                            stroke="#ffffff"
                            strokeWidth="2"
                          >
                            <title>{`${row.label}: ${formatCurrency(row.amount)}`}</title>
                          </path>
                        );
                      });
                    })()}
                    <circle cx="120" cy="120" r="50" fill="#ffffff" />
                    <text x="120" y="112" textAnchor="middle" fontSize="12" fill="#64748b" fontWeight="600">
                      Total
                    </text>
                    <text x="120" y="132" textAnchor="middle" fontSize="14" fill="#0f172a" fontWeight="700">
                      {formatCurrency(totalBreakdown)}
                    </text>
                  </svg>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {breakdownRows.map((row, index) => {
                    const share = formatSharePercent(row.amount, totalBreakdown);
                    return (
                      <div
                        key={row.key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "14px 1fr auto",
                          gap: 10,
                          alignItems: "center",
                          padding: "10px 12px",
                          background: "#f8fafc",
                          border: "1px solid #eef2f7",
                          borderRadius: 10,
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: pieColors[index % pieColors.length],
                            display: "inline-block",
                          }}
                        />
                        <div>
                          <div style={{ fontSize: 13, color: "#334155", fontWeight: 700 }}>{row.label}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{share}% of total</div>
                        </div>
                        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 700 }}>{formatCurrency(row.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="reports-card">
          <h2 className="reports-card-title">Approval Status</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {[
              { label: "Pending", value: approvalCounts.pending, color: "#b45309", bg: "#fffbeb" },
              { label: "Approved", value: approvalCounts.approved, color: "#166534", bg: "#f0fdf4" },
              { label: "Rejected", value: approvalCounts.rejected, color: "#b91c1c", bg: "#fef2f2" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: item.bg, borderRadius: 10 }}>
                <span style={{ fontWeight: 600, color: item.color }}>{item.label}</span>
                <span style={{ fontWeight: 700, color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="reports-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="reports-card-title" style={{ marginBottom: 4 }}>Expense Table</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              {filteredExpenseRows.length} of {expenseRows.length} expenses
              {scopeLabel ? ` • Scope: ${scopeLabel}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              className="report-filter report-search-input"
              type="text"
              placeholder="Search expenses..."
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
            />
            <select
              className="report-filter"
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value)}
            >
              <option value="all">All Expenses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="travel">Travel</option>
              <option value="food">Food</option>
              <option value="hotel">Hotel</option>
              <option value="client_meeting">Client Meeting</option>
              <option value="marketing">Marketing</option>
              <option value="event">Event</option>
              <option value="other">Other</option>
              <option value="lead">Lead</option>
              <option value="deal">Deal</option>
              <option value="event/expos">Event/Expos</option>
            </select>

            <button
              type="button"
              className="report-type-btn"
              onClick={handleExportExcel}
              disabled={filteredExpenseRows.length === 0}
              style={{
                minWidth: 170,
                background: "#16a34a",
                color: "#fff",
                borderColor: "#16a34a",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <i className="bi bi-file-earmark-excel" aria-hidden="true" />
              Export Excel
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, overflowX: "auto" }}>
          <table className="crm-auto-responsive-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Expense No", "Date", "Vendor", "Category", "Reference", "Amount", "GST", "Status", "User"].map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      fontSize: 12,
                      color: "#475569",
                      borderBottom: "1px solid #e2e8f0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredExpenseRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "18px 14px", color: "#94a3b8", textAlign: "center" }}>
                    {loading ? "Loading..." : error ? error : expenseRows.length === 0 ? noExpensesMessage : "No expenses match this search or filter."}
                  </td>
                </tr>
              ) : (
                filteredExpenseRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 14px", color: "#334155", fontWeight: 600 }}>{row.expenseNo || "--"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", whiteSpace: "nowrap" }}>{formatDate(row.expenseDate)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.vendorName}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.categoryLabel}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.referenceType || "--"}</td>
                    <td style={{ padding: "12px 14px", color: "#334155", fontWeight: 700 }}>{formatCurrency(row.totalAmount)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{formatCurrency(row.gstAmount)}</td>
                    <td style={{ padding: "12px 14px", color: row.approvalStatus === "approved" ? "#15803d" : row.approvalStatus === "rejected" ? "#b91c1c" : "#b45309", fontWeight: 600, textTransform: "capitalize" }}>
                      {row.approvalStatus}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{row.userName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default ExpenseTab;
