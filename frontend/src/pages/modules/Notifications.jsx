import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import "./styles/Notifications.css";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveNotificationRoute(item = {}) {
  const relatedType = String(item.relatedType || "").toLowerCase();
  const relatedId = String(item.relatedId || "").trim();

  if (!relatedId) {
    if (relatedType.includes("followup") || relatedType.includes("meeting")) return "/followups";
    if (relatedType.includes("event")) return "/events";
    if (relatedType.includes("expense")) return "/expenses";
    return "";
  }

  if (relatedType.includes("lead")) return `/leads/${relatedId}`;
  if (relatedType.includes("event")) return "/events";
  if (relatedType.includes("expense")) return "/expenses";
  if (relatedType.includes("meeting") || relatedType.includes("followup")) return "/followups";
  if (relatedType.includes("profile") || relatedType.includes("user")) return "/profile";
  return "";
}

function Notifications() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("all");
  const [notifications, setNotifications] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [error, setError] = useState("");
  const [reminderError, setReminderError] = useState("");

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError("");
      const { data } = await API.get("/notifications");
      setNotifications(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  const loadReminders = async () => {
    try {
      setLoadingReminders(true);
      setReminderError("");
      const { data } = await API.get("/notifications/reminders");
      setReminders(Array.isArray(data) ? data : []);
    } catch (err) {
      setReminderError(err?.response?.data?.message || "Failed to load reminders");
    } finally {
      setLoadingReminders(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    loadReminders();
  }, []);

  const visibleItems = useMemo(() => {
    if (activeTab === "reminders") return reminders;
    return notifications;
  }, [activeTab, reminders, notifications]);

  const isBusy = activeTab === "reminders" ? loadingReminders : loading;
  const visibleError = activeTab === "reminders" ? reminderError : error;

  return (
    <div className="notifications-page">

      <div className="notifications-tabs">
        <button
          type="button"
          className={`notifications-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All Notifications
          <span>{notifications.length}</span>
        </button>
        <button
          type="button"
          className={`notifications-tab-btn ${activeTab === "reminders" ? "active" : ""}`}
          onClick={() => setActiveTab("reminders")}
        >
          Upcoming Reminders
          <span>{reminders.length}</span>
        </button>
      </div>

      <div className="notifications-list-wrap">
        {isBusy ? <div className="notifications-empty">Loading...</div> : null}
        {!isBusy && visibleError ? <div className="notifications-error">{visibleError}</div> : null}
        {!isBusy && !visibleError && visibleItems.length === 0 ? (
          <div className="notifications-empty">
            {activeTab === "reminders" ? "No upcoming reminders found." : "No notifications found."}
          </div>
        ) : null}

        {!isBusy && !visibleError
          ? visibleItems.map((item) => {
              const route = resolveNotificationRoute(item);
              return (
                <div key={item._id} className="notifications-item">
                  <div className="notifications-item-main">
                    <h4>{item.title || "Notification"}</h4>
                    <p>{item.message || "No message available."}</p>
                  </div>
                  <div className="notifications-item-meta">
                    <span>{formatDateTime(item.reminderAt || item.createdAt)}</span>
                    {route ? (
                      <button
                        type="button"
                        className="notifications-view-btn"
                        onClick={() => navigate(route)}
                      >
                        View
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

export default Notifications;
