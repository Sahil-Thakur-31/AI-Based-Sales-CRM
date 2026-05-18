import React, { useMemo, useState } from "react";
import { FaSyncAlt } from "react-icons/fa";
import API from "../../../api";

function formatValue(metric, value) {
  if (typeof value === "string" && value.trim() !== "" && Number.isNaN(Number(value))) {
    return value;
  }

  const numeric = Number(value || 0);
  if (
    [
      "revenue",
      "avg_deal_size",
      "expense_total",
      "approved_total",
      "lost_revenue",
      "inactive_deal_value",
      "top_clients_revenue",
    ].includes(metric)
  ) {
    return numeric.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });
  }

  if (metric === "win_rate" || metric === "conversion_rate") {
    return `${numeric.toFixed(1)}%`;
  }

  return numeric.toLocaleString("en-IN");
}

function normalizeSearchValue(value) {
  return String(value ?? "").toLowerCase().trim();
}

function formatSelection(selection) {
  if (!selection?.period) return "All time";
  if (selection.period === "monthly") return `${selection.month}/${selection.year}`;
  if (selection.period === "quarterly") return `${String(selection.quarter || "").toUpperCase()} ${selection.year}`;
  return String(selection.year || "All time");
}

function formatProviderLabel(provider) {
  const value = String(provider || "").toLowerCase();
  if (value === "gemini") return "Gemini";
  if (value === "heuristic") return "Heuristic";
  return "Deterministic";
}

function getProviderBadgeStyle(provider) {
  const value = String(provider || "").toLowerCase();
  if (value === "gemini") {
    return {
      background: "#ecfeff",
      color: "#155e75",
      border: "1px solid #a5f3fc",
    };
  }

  if (value === "heuristic") {
    return {
      background: "#fffbeb",
      color: "#92400e",
      border: "1px solid #fde68a",
    };
  }

  return {
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
  };
}

function getCountMetricDescriptor(metric) {
  const map = {
    deal_count: "deals",
    won_deals: "won deals",
    lost_deals: "lost deals",
    active_deals: "active deals",
    lead_count: "leads",
    converted_count: "converted leads",
    non_converted_count: "non-converted leads",
    uncontacted_count: "uncontacted leads",
    qualified_count: "qualified leads",
    deleted_leads: "deleted leads",
    inactive_leads: "inactive leads",
    expense_count: "expenses",
    pending_count: "pending expenses",
    rejected_count: "rejected expenses",
    followup_count: "follow-ups",
    user_count: "users",
    active_users: "active users",
    inactive_users: "inactive users",
    deleted_users: "deleted users",
    team_count: "teams",
  };

  return map[metric] || "";
}

function CustomTab() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [tableSearch, setTableSearch] = useState("");

  const presetGroups = useMemo(
    () => [
      {
        label: "Deals / Sales",
        keywords: ["deal", "deals", "sales", "revenue", "performer", "pipeline", "stage"],
        questions: [
          "Show top performers this month",
          "Show all deals",
          "List this month deals",
          "Show revenue by salesperson this quarter",
          "Show deals by stage",
          "Show biggest deals this month",
          "Show delayed deals",
          "Show sales revenue this year",
        ],
      },
      {
        label: "Leads",
        keywords: ["lead", "leads", "source", "converted", "uncontacted"],
        questions: [
          "Show total leads",
          "Show uncontacted leads this month",
          "Show converted leads this quarter",
          "Show leads by source this year",
          "Show leads assigned to me",
        ],
      },
      {
        label: "Expenses",
        keywords: ["expense", "expenses", "approved", "pending", "spend", "category"],
        questions: [
          "Show total expenses",
          "Show expenses by category this year",
          "Show pending expenses this quarter",
          "Show approved expenses this year",
          "Show expense trend",
        ],
      },
      {
        label: "Clients / Follow-Ups / Users / Teams",
        keywords: ["client", "clients", "followup", "follow-up", "meeting", "user", "users", "employee", "employees", "team", "teams", "target"],
        questions: [
          "Show top clients this quarter",
          "Show inactive clients",
          "Show today's follow-ups",
          "Show overdue follow-ups",
          "What are teams and their targets",
          "Show users by role",
          "List users",
          "Show all teams",
        ],
      },
    ],
    []
  );

  const suggestionEntries = useMemo(
    () =>
      presetGroups.flatMap((group) =>
        group.questions.map((item) => ({
          question: item,
          label: group.label,
          keywords: group.keywords || [],
        }))
      ),
    [presetGroups]
  );

  const allSupportedQuestions = useMemo(
    () => suggestionEntries.map((entry) => entry.question),
    [suggestionEntries]
  );

  const normalizeText = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const scoreSuggestion = (entry, typedValue) => {
    const questionText = normalizeText(entry.question);
    const labelText = normalizeText(entry.label);
    const tokens = typedValue.split(" ").filter(Boolean);
    let score = 0;

    if (questionText.startsWith(typedValue)) score += 120;
    else if (questionText.includes(typedValue)) score += 70;

    if (labelText.includes(typedValue)) score += 55;

    for (const keyword of entry.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) continue;
      if (normalizedKeyword === typedValue) score += 80;
      else if (normalizedKeyword.includes(typedValue) || typedValue.includes(normalizedKeyword)) score += 35;
    }

    for (const token of tokens) {
      if (questionText.includes(token)) score += 14;
      if (labelText.includes(token)) score += 12;
      for (const keyword of entry.keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (normalizedKeyword === token) score += 18;
        else if (normalizedKeyword.includes(token) || token.includes(normalizedKeyword)) score += 8;
      }
    }

    return score;
  };

  const suggestedQuestions = useMemo(() => {
    const typed = normalizeText(question);
    if (!typed) {
      return [];
    }

    const exactMatch = allSupportedQuestions.some(
      (item) => normalizeText(item) === typed
    );
    if (exactMatch) {
      return [];
    }

    return suggestionEntries
      .map((entry) => ({
        ...entry,
        score: scoreSuggestion(entry, typed),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.question.localeCompare(b.question);
      })
      .slice(0, 6);
  }, [allSupportedQuestions, question, suggestionEntries]);

  async function generateReport(promptText) {
    const finalQuestion = String(promptText || question).trim();
    if (!finalQuestion) {
      setError("Please enter a reporting question.");
      return;
    }

    setQuestion(finalQuestion);
    setLoading(true);
    setError("");

    try {
      const response = await API.post("/reports/ai-query", {
        question: finalQuestion,
      });
      setResult(response.data || null);
      setTableSearch("");
    } catch (err) {
      console.error("Failed to generate AI report:", err);
      setError(err?.response?.data?.detail || err?.response?.data?.message || "Failed to generate report");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function resetQuestion() {
    setQuestion("");
    setError("");
    setResult(null);
    setTableSearch("");
  }

  const filteredCustomRows = (result?.data || []).filter((row) => {
    const query = normalizeSearchValue(tableSearch);
    if (!query) return true;
    const haystack = [row?.label, row?.value].map(normalizeSearchValue).join(" ");
    return haystack.includes(query);
  });

  const shouldShowSuggestions =
    suggestedQuestions.length > 0 &&
    !loading &&
    normalizeText(question) !== normalizeText(result?.question || "");

  const countMetricDescriptor = getCountMetricDescriptor(result?.metric);
  const isSingleSummaryCountReport = Boolean(
    result &&
    countMetricDescriptor &&
    Number(result?.summary?.rowCount || 0) === 1 &&
    String(result?.data?.[0]?.label || "").trim().toLowerCase() === "all"
  );
  const summaryFooterText = isSingleSummaryCountReport
    ? `Total ${countMetricDescriptor}`
    : `${Number(result?.summary?.rowCount || 0).toLocaleString("en-IN")} rows`;
  const tableMetaText =
    isSingleSummaryCountReport && !tableSearch.trim()
      ? `${Number(result?.summary?.value || 0).toLocaleString("en-IN")} row${Number(result?.summary?.value || 0) === 1 ? "" : "s"}`
      : `${filteredCustomRows.length} of ${Number(result?.summary?.rowCount || 0).toLocaleString("en-IN")} rows`;
  const displayRows = isSingleSummaryCountReport
    ? [
        {
          label: summaryFooterText,
          value: result?.summary?.value ?? 0,
        },
      ]
    : filteredCustomRows;

  return (
    <div className="custom-tab">
      <section className="reports-card">
        <h2 className="reports-card-title">AI Custom Report</h2>
        <div className="assistant-box">
          <label className="assistant-label">Ask a question in natural language:</label>

          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Show top performers this month, Show uncontacted leads this quarter, Show expenses by category this year"
              className="assistant-input"
              style={{ paddingRight: question ? 52 : undefined }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  generateReport();
                }
              }}
            />

            {(question || result || error) && (
              <span
                role="button"
                tabIndex={loading ? -1 : 0}
                onClick={() => {
                  if (!loading) resetQuestion();
                }}
                onKeyDown={(event) => {
                  if (loading) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    resetQuestion();
                  }
                }}
                aria-label="Reset question"
                title="Reset question"
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 16,
                  transform: "translateY(-50%)",
                  color: "#64748b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.45 : 1,
                }}
              >
                <FaSyncAlt size={16} />
              </span>
            )}
          </div>

          {shouldShowSuggestions && (
            <div
              style={{
                marginTop: 12,
                border: "1px solid #dbeafe",
                borderRadius: 14,
                background: "#ffffff",
                boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
                overflow: "hidden",
              }}
            >
              {suggestedQuestions.map((item, index) => (
                <button
                  key={item.question}
                  type="button"
                  onClick={() => setQuestion(item.question)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    border: "none",
                    borderBottom: index === suggestedQuestions.length - 1 ? "none" : "1px solid #eff6ff",
                    background: item.question === question ? "#eff6ff" : "#ffffff",
                    color: "#1e293b",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{item.question}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: "#64748b" }}>{item.label}</div>
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="primary-gradient-btn" onClick={() => generateReport()} disabled={loading}>
              {loading ? "Generating..." : "Generate Report"}
            </button>
          </div>

          <p style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>
            Supported modules: Sales, Deals, Leads, Expenses, Clients, Follow-ups, Users, Teams. Time period is optional, so you can ask overall questions or monthly, quarterly, yearly, and today-based ones.
          </p>

          {error && (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
              {error}
            </div>
          )}
        </div>
      </section>

      {result && (
        <>
          <section className="reports-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h2 className="reports-card-title" style={{ marginBottom: 8 }}>{result.title}</h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                  {String(result.module || "--").toUpperCase()} report
                  {" · "}
                  {formatSelection(result.selection)}
                </p>
              </div>
              <div
                style={{
                  minWidth: 220,
                  padding: "16px 18px",
                  borderRadius: 16,
                  background: "linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%)",
                  border: "1px solid #dbeafe",
                }}
              >
                <div style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {result.summary?.label || "Summary"}
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: "#0f172a", marginTop: 8 }}>
                  {formatValue(result.metric, result.summary?.value)}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>{summaryFooterText}</div>
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>{tableMetaText}</div>
              {!isSingleSummaryCountReport && (
                <input
                  className="report-filter report-search-input"
                  type="text"
                  placeholder="Search report rows..."
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                />
              )}
            </div>

            <div style={{ marginTop: 18, overflowX: "auto" }}>
              <table className="crm-auto-responsive-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {result.columns?.map((column) => (
                      <th
                        key={column.key}
                        style={{
                          textAlign: "left",
                          padding: "12px 14px",
                          fontSize: 12,
                          color: "#475569",
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={result.columns?.length || 2} style={{ padding: "18px 14px", color: "#94a3b8", textAlign: "center" }}>
                        No rows match this search.
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((row, index) => (
                      <tr key={`${row.label}-${index}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px 14px", color: "#334155", fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: "12px 14px", color: "#475569" }}>{formatValue(result.metric, row.value)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="reports-card">
            <h2 className="reports-card-title">What You Can Ask</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginTop: 16 }}>
              {presetGroups.map((group) => (
                <div key={group.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                  <strong style={{ display: "block", marginBottom: 10, color: "#0f172a" }}>{group.label}</strong>
                  <ol style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: 13, display: "grid", gap: 8 }}>
                    {group.questions.slice(0, 6).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default CustomTab;
