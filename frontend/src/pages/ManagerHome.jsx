import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";
import FormErrorSlot from "../components/FormErrorSlot";
import MeetingsEventsPanel from "../components/MeetingsEventsPanel";
import StatCard from "../components/StatCard";
import { minLength } from "../utils/formValidation";
import "../styles/managerDashboard.css";

const EMPTY_DONE_MODAL = {
  open: false,
  id: "",
  kind: "followup",
  durationMinutes: "",
  minutesOfMeeting: ""
};

const EMPTY_CANCEL_MODAL = {
  open: false,
  id: "",
  kind: "followup",
  reason: ""
};

function Dashboard({ dashboardEndpoint = "/api/manager/dashboard" }) {
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState("month");
  const [selectedItem, setSelectedItem] = useState(null);
  const [doneModal, setDoneModal] = useState(EMPTY_DONE_MODAL);
  const [doneModalError, setDoneModalError] = useState("");
  const [savingDone, setSavingDone] = useState(false);
  const [cancelModal, setCancelModal] = useState(EMPTY_CANCEL_MODAL);
  const [cancelModalError, setCancelModalError] = useState("");
  const [savingCancel, setSavingCancel] = useState(false);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    });
  }

  function formatTime(value) {
    if (!value) return "--";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";

    return date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getFollowupColor(priority = "") {
    const normalized = String(priority).toLowerCase();
    if (normalized === "high") return "red";
    if (normalized === "medium") return "orange";
    return "blue";
  }

  function getPriorityRank(priority = "") {
    const normalized = String(priority).toLowerCase();
    if (normalized === "high") return 3;
    if (normalized === "medium") return 2;
    if (normalized === "low") return 1;
    return 0;
  }

  function isCompletedStatus(status = "") {
    return String(status).toLowerCase() === "completed";
  }

  function isCancelledStatus(status = "") {
    return String(status).toLowerCase() === "cancelled";
  }

  function formatStatus(status = "") {
    if (isCompletedStatus(status)) return "Completed";
    if (isCancelledStatus(status)) return "Cancelled";
    return "Not Completed";
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        setError("");
        const response = await API.get(dashboardEndpoint, {
          params: { range },
          signal: controller.signal
        });
        setDashboardData(response.data);
      } catch (err) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setError(err.response?.data?.message || "Failed to load dashboard");
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [dashboardEndpoint, range]);

  const refreshDashboard = async () => {
    const response = await API.get(dashboardEndpoint, { params: { range } });
    setDashboardData(response.data);
  };

  const openView = (item) => {
    setSelectedItem(item);
  };

  const closeView = () => {
    setSelectedItem(null);
  };

  const openDoneModal = (item) => {
    setDoneModal({
      open: true,
      id: String(item.actionId || item.id || ""),
      kind: item.kind === "meeting" ? "meeting" : "followup",
      durationMinutes: item.durationMinutes ? String(item.durationMinutes) : "",
      minutesOfMeeting: item.notes || ""
    });
    setDoneModalError("");
  };

  const closeDoneModal = () => {
    if (savingDone) return;
    setDoneModal(EMPTY_DONE_MODAL);
    setDoneModalError("");
  };

  const openCancelModal = (item) => {
    setCancelModal({
      open: true,
      id: String(item.actionId || item.id || ""),
      kind: item.kind === "meeting" ? "meeting" : "followup",
      reason: item.cancelReason || item.notes || ""
    });
    setCancelModalError("");
  };

  const closeCancelModal = () => {
    if (savingCancel) return;
    setCancelModal(EMPTY_CANCEL_MODAL);
    setCancelModalError("");
  };

  const submitDone = async (e) => {
    e.preventDefault();
    setDoneModalError("");

    if (!doneModal.id) {
      return setDoneModalError("Record id is missing");
    }
    if (!doneModal.durationMinutes || Number(doneModal.durationMinutes) < 1) {
      return setDoneModalError("Duration of minutes is required");
    }
    const notesError = minLength(
      doneModal.minutesOfMeeting,
      3,
      doneModal.kind === "meeting" ? "Minutes of meeting" : "Completion notes"
    );
    if (notesError) {
      return setDoneModalError(
        notesError
      );
    }

    try {
      setSavingDone(true);
      await API.patch(`/followups/${doneModal.id}/status`, {
        status: "completed",
        durationMinutes: Number(doneModal.durationMinutes),
        notes: doneModal.minutesOfMeeting.trim()
      });
      await refreshDashboard();
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              status: "completed",
              durationMinutes: Number(doneModal.durationMinutes),
              notes: doneModal.minutesOfMeeting.trim()
            }
          : prev
      );
      setDoneModal(EMPTY_DONE_MODAL);
    } catch (err) {
      console.error(err);
      setDoneModalError(err?.response?.data?.message || `Failed to complete ${doneModal.kind}`);
    } finally {
      setSavingDone(false);
    }
  };

  const submitCancel = async (e) => {
    e.preventDefault();
    setCancelModalError("");

    if (!cancelModal.id) {
      return setCancelModalError("Record id is missing");
    }
    const reasonError = minLength(cancelModal.reason, 3, "Cancellation reason");
    if (reasonError) return setCancelModalError(reasonError);

    try {
      setSavingCancel(true);
      await API.patch(`/followups/${cancelModal.id}/status`, {
        status: "cancelled",
        cancelReason: cancelModal.reason.trim(),
        notes: cancelModal.reason.trim()
      });
      await refreshDashboard();
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              status: "cancelled",
              cancelReason: cancelModal.reason.trim(),
              notes: cancelModal.reason.trim()
            }
          : prev
      );
      setCancelModal(EMPTY_CANCEL_MODAL);
    } catch (err) {
      console.error(err);
      setCancelModalError(err?.response?.data?.message || "Failed to cancel item");
    } finally {
      setSavingCancel(false);
    }
  };

  if (!dashboardData) {
    return <p>{error || "Loading..."}</p>;
  }

  const labels = dashboardData.labels || {};
  const stats = Array.isArray(dashboardData.statCards) ? dashboardData.statCards : [];
  const timelineItems = [
    ...(dashboardData.followups || []),
    ...(dashboardData.meetings || [])
  ]
    .sort((a, b) => {
      const priorityDiff = getPriorityRank(b.priority) - getPriorityRank(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime();
    })
    .slice(0, 3);

  return (
    <div className="ManagerDashboard">
      <div className="dashboard container-fluid">
        {error ? <p>{error}</p> : null}

        <div className="manager-stats-grid mt-2">
          {stats.map((stat, index) => (
            <div key={index} className="manager-stat-col">
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        <div className="row mt-4">
          <div className="col-12">
            <div className="panel">
              <MeetingsEventsPanel
                activityData={dashboardData.activity}
                range={range}
                onRangeChange={setRange}
              />
            </div>
          </div>
        </div>

        <div className="row mt-4 manager-summary-row">
          <div className="col-12 col-lg-8 manager-summary-left">
            <div className="panel manager-followups-panel">
              <div className="manager-followups-head">
                <h3>{labels.followupsHeading || "Follow-ups & Meetings"}</h3>
                <button
                  className="manager-mini-btn done"
                  type="button"
                  onClick={() => navigate("/followups")}
                >
                  View All
                </button>
              </div>

              {timelineItems.length ? (
                timelineItems.map((item) => (
                  <div key={item.id} className={`follow-item ${getFollowupColor(item.priority)}`}>
                    <div>
                      <strong>{item.company}</strong>
                      <div className="follow-item-meta">
                        <span className={`follow-kind follow-kind--${item.kind || "followup"}`}>
                          {item.kind === "meeting" ? "Meeting" : "Follow-up"}
                        </span>
                        <span
                          className={`follow-status ${
                            isCompletedStatus(item.status)
                              ? "completed"
                              : isCancelledStatus(item.status)
                                ? "cancelled"
                                : "pending"
                          }`}
                        >
                          {formatStatus(item.status)}
                        </span>
                      </div>
                      <p>{item.message}</p>
                    </div>
                    <div className="text-end follow-item-right">
                      <small>{formatTime(item.dueAt)}</small>
                      <div>{item.priority}</div>
                      <div className="follow-item-actions">
                        <button className="manager-mini-btn done" type="button" onClick={() => openView(item)}>
                          View
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p>No follow-ups or meetings found for this range.</p>
              )}
            </div>
          </div>

          <div className="col-12 col-lg-4 manager-summary-right">
            <div className="panel manager-side-panel">
              <h3>Pipeline Value</h3>
              <div className="pipeline-value">{formatCurrency(dashboardData.summary?.pipelineValue)}</div>
              <div>Lead Value Amt: {formatCurrency(dashboardData.summary?.leadPipelineValue)}</div>
              <div>Deal Value Amt: {formatCurrency(dashboardData.summary?.dealPipelineValue)}</div>
            </div>

            <div className="panel manager-side-panel">
              <div className="manager-followups-head">
                <h3>AI Insights</h3>
                <button
                  className="manager-mini-btn done"
                  type="button"
                  onClick={() => navigate("/ai-insights")}
                >
                  View All
                </button>
              </div>

              {(dashboardData.insights || []).map((insight) => (
                <div key={insight.id} className={`insight ${insight.severity || "purple"}`}>
                  <strong>{insight.type}</strong>
                  <p>{insight.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedItem && (
        <div className="manager-modal-overlay" role="dialog" aria-modal="true" aria-label="View item">
          <div className="manager-modal-card">
            <div className="manager-modal-head">
              <h3>{selectedItem.kind === "meeting" ? "Meeting Details" : "Follow-up Details"}</h3>
            </div>
            <div className="manager-detail-grid">
              <div className="manager-detail-item"><div className="k">Client</div><div className="v">{selectedItem.company || "-"}</div></div>
              <div className="manager-detail-item"><div className="k">Type</div><div className="v">{selectedItem.kind === "meeting" ? "Meeting" : "Follow-up"}</div></div>
              <div className="manager-detail-item"><div className="k">Time</div><div className="v">{formatTime(selectedItem.dueAt)}</div></div>
              <div className="manager-detail-item"><div className="k">Priority</div><div className="v">{selectedItem.priority || "-"}</div></div>
              <div className="manager-detail-item"><div className="k">Status</div><div className="v">{formatStatus(selectedItem.status)}</div></div>
              <div className="manager-detail-item manager-detail-item-full"><div className="k">Details</div><div className="v">{selectedItem.message || "-"}</div></div>
              <div className="manager-detail-item manager-detail-item-full"><div className="k">Notes</div><div className="v">{selectedItem.notes || "-"}</div></div>
            </div>
            <div className="manager-modal-actions">
              <button className="manager-mini-btn" type="button" onClick={closeView}>Close</button>
              <button
                className={`manager-mini-btn cancel ${isCancelledStatus(selectedItem.status) ? "cancelled" : ""}`}
                type="button"
                onClick={() => openCancelModal(selectedItem)}
                disabled={isCompletedStatus(selectedItem.status) || isCancelledStatus(selectedItem.status)}
              >
                {isCancelledStatus(selectedItem.status) ? "Cancelled" : "Cancel"}
              </button>
              <button
                className="manager-mini-btn done"
                type="button"
                onClick={() => openDoneModal(selectedItem)}
                disabled={isCompletedStatus(selectedItem.status) || isCancelledStatus(selectedItem.status)}
              >
                {isCompletedStatus(selectedItem.status) ? "Completed" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {doneModal.open && (
        <div className="manager-modal-overlay" role="dialog" aria-modal="true" aria-label={`Complete ${doneModal.kind}`}>
          <form className="manager-modal-card" onSubmit={submitDone}>
            <div className="manager-modal-head">
              <h3>{doneModal.kind === "meeting" ? "Complete Meeting" : "Complete Follow-up"}</h3>
            </div>
            <div className="manager-form-grid">
              <label className="manager-form-label">
                Duration of Minutes*
                <input
                  className="manager-field"
                  type="number"
                  min="1"
                  value={doneModal.durationMinutes}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, durationMinutes: e.target.value }))}
                />
              </label>
              <label className="manager-form-label manager-form-label-full">
                {doneModal.kind === "meeting" ? "Minutes Of Meeting (MOM)*" : "Completion Notes*"}
                <textarea
                  className="manager-field manager-textarea"
                  rows={5}
                  value={doneModal.minutesOfMeeting}
                  onChange={(e) => setDoneModal((prev) => ({ ...prev, minutesOfMeeting: e.target.value }))}
                />
              </label>
            </div>
            <FormErrorSlot message={doneModalError} className="form-error-slot-global manager-form-error-slot" />
            <div className="manager-modal-actions">
              <button className="manager-mini-btn done" type="submit" disabled={savingDone}>
                {savingDone ? "Saving..." : doneModal.kind === "meeting" ? "Save & Complete" : "Save & Mark Done"}
              </button>
              <button className="manager-mini-btn" type="button" onClick={closeDoneModal} disabled={savingDone}>
                Back
              </button>
            </div>
          </form>
        </div>
      )}

      {cancelModal.open && (
        <div className="manager-modal-overlay" role="dialog" aria-modal="true" aria-label={`Cancel ${cancelModal.kind}`}>
          <form className="manager-modal-card" onSubmit={submitCancel}>
            <div className="manager-modal-head">
              <h3>{cancelModal.kind === "meeting" ? "Cancel Meeting" : "Cancel Follow-up"}</h3>
            </div>
            <div className="manager-form-grid">
              <label className="manager-form-label manager-form-label-full">
                Cancellation Reason*
                <textarea
                  className="manager-field manager-textarea"
                  rows={5}
                  value={cancelModal.reason}
                  onChange={(e) => setCancelModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </label>
            </div>
            <FormErrorSlot message={cancelModalError} className="form-error-slot-global manager-form-error-slot" />
            <div className="manager-modal-actions">
              <button className="manager-mini-btn" type="submit" disabled={savingCancel}>
                {savingCancel ? "Saving..." : "Save Cancellation"}
              </button>
              <button className="manager-mini-btn" type="button" onClick={closeCancelModal} disabled={savingCancel}>
                Back
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
