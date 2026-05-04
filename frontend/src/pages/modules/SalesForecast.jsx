import React, { useEffect, useState } from "react";
import API from "../../api";
import "./styles/SalesForecasting.css";

const RANGE_OPTIONS = [
  { value: "all", label: "All Deals" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
];

const EMPTY_SUMMARY = {
  totalPipelineValue: 0,
  totalActiveDeals: 0,
  expectedWinRate: 0,
  forecastRevenue: 0,
  avgSalesCycleDays: 0,
  modelName: "",
  selectedRange: "all",
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));

const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

const AiBadge = () => <span className="forecast-ai-badge">AI</span>;

const SalesForecasting = () => {
  const [forecastData, setForecastData] = useState(null);
  const [selectedRange, setSelectedRange] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    const loadForecast = async () => {
      try {
        setLoading(true);
        setError("");
        const params = selectedRange === "all" ? {} : { range: selectedRange };
        const { data } = await API.get("/sales-forecast", { params });
        if (!ignore) {
          setForecastData(data);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err?.response?.data?.message ||
              "Unable to load model predictions for the sales forecast page."
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadForecast();

    return () => {
      ignore = true;
    };
  }, [selectedRange]);

  const summary = forecastData?.summary || EMPTY_SUMMARY;
  const pipelineData = forecastData?.pipeline || [];

  return (
    <div className="forecast-container">
      <div className="topBar forecast-top-bar">
        <div className="topActions">
          <select
            className="select forecast-range-select"
            value={selectedRange}
            onChange={(event) => setSelectedRange(event.target.value)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <h3>{formatCurrency(summary.totalPipelineValue)}</h3>
          <p>Total Pipeline Value</p>
          <span className="positive">{summary.totalActiveDeals} active deals</span>
        </div>

        <div className="kpi-card">
          <AiBadge />
          <h3>{formatPercent(summary.expectedWinRate)}</h3>
          <p>Expected Win Rate</p>
        </div>

        <div className="kpi-card">
          <AiBadge />
          <h3>{formatCurrency(summary.forecastRevenue)}</h3>
          <p>Forecast Revenue</p>
        </div>

        <div className="kpi-card">
          <h3>{Math.round(summary.avgSalesCycleDays || 0)} days</h3>
          <p>Avg. Sales Cycle</p>
        </div>
      </div>

      <div className="pipeline-section">
        <h3>Sales Pipeline</h3>

        {loading ? (
          <div className="forecast-message">Loading forecast from model...</div>
        ) : null}
        {!loading && error ? (
          <div className="forecast-message forecast-error">{error}</div>
        ) : null}
        {!loading && !error && pipelineData.length === 0 ? (
          <div className="forecast-message">No open deals available for forecast.</div>
        ) : null}

        <div className="pipeline-grid">
          {pipelineData.map((stage) => (
            <div key={stage.stageKey} className="pipeline-card">
              <div className="stage-header">
                <h4>{stage.stageLabel}</h4>
                <h5>{formatCurrency(stage.value)}</h5>
                <p>{stage.deals} deals</p>
              </div>

              {stage.items.map((item) => (
                <div key={item._id} className="deal-card">
                  <div className="deal-card-main">
                    <span>{item.name}</span>
                    {item.companyName ? <small>{item.companyName}</small> : null}
                    <small>
                      Win rate: {formatPercent(item.winProbability)} | Forecast:{" "}
                      {formatCurrency(item.forecastRevenueContribution)}
                    </small>
                  </div>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SalesForecasting;
