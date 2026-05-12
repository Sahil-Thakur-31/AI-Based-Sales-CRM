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

function CustomTab() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const presetGroups = useMemo(
    () => [
      {
        label: "Deals",
        questions: [
          "Show top performers this month",
          "List this month deals",
          "Show revenue by salesperson this quarter",
          "Show deals by stage",
          "Show biggest deals this month",
          "Show delayed deals",
        ],
      },
      {
        label: "Leads",
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
        questions: [
          "Show total expenses",
          "Show expenses by category this year",
          "Show pending expenses this quarter",
          "Show approved expenses this year",
          "Show expense trend",
        ],
      },
      {
        label: "Clients / Follow-Ups / Teams",
        questions: [
          "Show top clients this quarter",
          "Show inactive clients",
          "Show today's follow-ups",
          "Show overdue follow-ups",
          "What are teams and their targets",
          "Show users by role",
          "List users",
          "Show teams",
          "Show sales revenue this year",
        ],
      },
    ],
    []
  );

  const allSupportedQuestions = useMemo(
    () => presetGroups.flatMap((group) => group.questions),
    [presetGroups]
  );

  const suggestedQuestions = useMemo(() => {
    const typed = question.trim().toLowerCase();
    if (!typed) {
      return [];
    }

    const exactMatch = allSupportedQuestions.some(
      (item) => item.toLowerCase() === typed
    );
    if (exactMatch) {
      return [];
    }

    return allSupportedQuestions
      .filter((item) => item.toLowerCase().includes(typed))
      .slice(0, 6);
  }, [allSupportedQuestions, question]);

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
    } catch (err) {
      console.error("Failed to generate AI report:", err);
      setError(err?.response?.data?.detail || err?.response?.data?.message || "Failed to generate report");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

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
              {suggestedQuestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setQuestion(item)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    border: "none",
                    borderBottom: "1px solid #eff6ff",
                    background: item === question ? "#eff6ff" : "#ffffff",
                    color: "#1e293b",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  {item}
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
          {result.parserWarning && (
            <section className="reports-card" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
              <h2 className="reports-card-title" style={{ color: "#92400e" }}>Parser Notice</h2>
              <p style={{ margin: "14px 0 0", color: "#92400e", fontSize: 14 }}>
                {result.parserWarning}
              </p>
            </section>
          )}

          <section className="kpi-grid">
            <div className="kpi-card neutral">
              <div className="kpi-value">{formatValue(result.metric, result.summary?.value)}</div>
              <span>{result.summary?.label || "Summary"}</span>
              <div className="kpi-meta">{result.title}</div>
            </div>
            <div className="kpi-card positive">
              <div className="kpi-value">{String(result.module || "--").toUpperCase()}</div>
              <span>Module</span>
              <div className="kpi-meta">AI detected report area</div>
            </div>
            <div className="kpi-card neutral">
              <div className="kpi-value">{result.groupBy || "Summary"}</div>
              <span>Grouping</span>
              <div className="kpi-meta">How rows are organized</div>
            </div>
            <div className="kpi-card neutral">
              <div className="kpi-value">{result.selection?.period || "--"}</div>
              <span>Period</span>
              <div className="kpi-meta">
                {result.selection?.period === "monthly"
                  ? `${result.selection?.month}/${result.selection?.year}`
                  : result.selection?.period === "quarterly"
                    ? `${String(result.selection?.quarter || "").toUpperCase()} ${result.selection?.year}`
                    : result.selection?.year}
              </div>
            </div>
            <div className={`kpi-card ${result.provider === "heuristic" ? "warning" : "positive"}`}>
              <div className="kpi-value">{result.provider === "gemini" ? "Gemini" : "Rule"}</div>
              <span>Interpreter</span>
              <div className="kpi-meta">
                {result.provider === "gemini"
                  ? "Gemini parsed the question"
                  : result.provider === "deterministic"
                    ? "Deterministic parser handled the question"
                    : "Fallback parser handled the question"}
              </div>
            </div>
          </section>

          <section className="reports-card">
            <h2 className="reports-card-title">Interpreted Query</h2>
            <pre
              style={{
                margin: 0,
                marginTop: 16,
                padding: 16,
                background: "#0f172a",
                color: "#e2e8f0",
                borderRadius: 12,
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(result.interpretedQuery, null, 2)}
            </pre>
          </section>

          <section className="reports-card">
            <h2 className="reports-card-title">Result Table</h2>
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
                  {(result.data || []).map((row, index) => (
                    <tr key={`${row.label}-${index}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "12px 14px", color: "#334155", fontWeight: 600 }}>{row.label}</td>
                      <td style={{ padding: "12px 14px", color: "#475569" }}>{formatValue(result.metric, row.value)}</td>
                    </tr>
                  ))}
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
