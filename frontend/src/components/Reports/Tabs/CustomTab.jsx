import React, { useMemo, useState } from "react";
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

  const filteredCustomRows = (result?.data || []).filter((row) => {
    const query = normalizeSearchValue(tableSearch);
    if (!query) return true;
    const haystack = [row?.label, row?.value].map(normalizeSearchValue).join(" ");
    return haystack.includes(query);
  });

  return (
    <div className="custom-tab">
      <section className="reports-card">
        <h2 className="reports-card-title">AI Custom Report</h2>
        <div className="assistant-box">
          <label className="assistant-label">Ask a question in natural language:</label>

          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Show top performers this month, Show uncontacted leads this quarter, Show expenses by category this year"
            className="assistant-input"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                generateReport();
              }
            }}
          />

          {!!suggestedQuestions.length && (
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

          <button className="primary-gradient-btn" onClick={() => generateReport()} disabled={loading}>
            {loading ? "Generating..." : "Generate Report"}
          </button>

          <p style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>
            Supported modules: Sales, Deals, Leads, Expenses, Clients, Follow-ups, Users, Teams. Use monthly, quarterly, yearly, or today-based report questions.
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
                  {result.selection?.period === "monthly"
                    ? `${result.selection?.month}/${result.selection?.year}`
                    : result.selection?.period === "quarterly"
                      ? `${String(result.selection?.quarter || "").toUpperCase()} ${result.selection?.year}`
                      : result.selection?.year}
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
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                  {Number(result.summary?.rowCount || 0).toLocaleString("en-IN")} rows
                </div>
              </div>
            </div>

            {result.parserWarning && (
              <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                {result.parserWarning}
              </div>
            )}

            <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {filteredCustomRows.length} of {Number(result.summary?.rowCount || 0).toLocaleString("en-IN")} rows
              </div>
              <input
                className="report-filter report-search-input"
                type="text"
                placeholder="Search report rows..."
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
              />
            </div>

            <div style={{ marginTop: 18, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
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
                  {filteredCustomRows.length === 0 ? (
                    <tr>
                      <td colSpan={result.columns?.length || 2} style={{ padding: "18px 14px", color: "#94a3b8", textAlign: "center" }}>
                        No rows match this search.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomRows.map((row, index) => (
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
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <strong style={{ display: "block", marginBottom: 10, color: "#0f172a" }}>Deals</strong>
                <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>Show top performers this month</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show all deals</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>List this month deals</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show revenue by salesperson this quarter</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show lost deals this year</p>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <strong style={{ display: "block", marginBottom: 10, color: "#0f172a" }}>Leads</strong>
                <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>Show uncontacted leads this month</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show converted leads this quarter</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show leads by source this year</p>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <strong style={{ display: "block", marginBottom: 10, color: "#0f172a" }}>Expenses</strong>
                <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>Show expenses by category this month</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show pending expenses this quarter</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show approved expenses this year</p>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
                <strong style={{ display: "block", marginBottom: 10, color: "#0f172a" }}>Clients, Follow-Ups, Users & Teams</strong>
                <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>Show top clients this quarter</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show inactive clients</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show overdue follow-ups</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>What are teams and their targets</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show all teams</p>
                <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 13 }}>Show users by role</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default CustomTab;
