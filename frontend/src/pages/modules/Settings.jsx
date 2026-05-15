import { useEffect, useState } from "react";
import API from "../../api";
import "./styles/Settings.css";
import reminderIcon from "../../assets/settings/reminder_18312774.png";

const DEFAULT_REMINDER_OPTIONS = [{ value: 10, unit: "minutes" }];
const DEFAULT_CHANNEL_PREFERENCES = {
  leads: true,
  followups: true,
  meetings: true,
  events: true,
  expenses: true,
};

const CHANNEL_TABS = [
  {
    id: "app",
    label: "App Notifications",
    description: "Show alerts inside CRM, including the notification center and navbar.",
  },
  {
    id: "email",
    label: "Email Notifications",
    description: "Send notification emails based on the modules enabled below.",
  },
];

const MODULE_OPTIONS = [
  {
    key: "leads",
    label: "Assigned Leads",
    description: "Lead assignment and reassignment alerts.",
  },
  {
    key: "followups",
    label: "Follow-ups",
    description: "Follow-up assignments, updates, and reminders.",
  },
  {
    key: "meetings",
    label: "Meetings",
    description: "Meeting assignments, updates, and reminders.",
  },
  {
    key: "events",
    label: "Events",
    description: "Event invitations and attendance notifications.",
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Expense approval and rejection updates.",
  },
];

function normalizeReminderOptions(options = []) {
  if (!Array.isArray(options)) return [...DEFAULT_REMINDER_OPTIONS];
  const normalized = options
    .map((opt) => {
      const value = Number(opt?.value);
      const unit = String(opt?.unit || "").toLowerCase();
      if (!Number.isFinite(value) || value < 1) return null;
      if (!["minutes", "hours", "days"].includes(unit)) return null;
      return { value: Math.floor(value), unit };
    })
    .filter(Boolean);
  return normalized.length ? normalized : [...DEFAULT_REMINDER_OPTIONS];
}

function normalizeChannelPreferences(source = {}) {
  return Object.keys(DEFAULT_CHANNEL_PREFERENCES).reduce((acc, key) => {
    acc[key] =
      source?.[key] === undefined
        ? DEFAULT_CHANNEL_PREFERENCES[key]
        : Boolean(source[key]);
    return acc;
  }, {});
}

function normalizeSettings(data = {}) {
  return {
    ...data,
    smartFollowupRemindersEnabled: true,
    appNotifications: normalizeChannelPreferences(data?.appNotifications),
    emailNotifications: normalizeChannelPreferences(data?.emailNotifications),
    reminderOptions: normalizeReminderOptions(data?.reminderOptions),
  };
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("app");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await API.get("/crm-settings/me");
      setSettings(normalizeSettings(res.data));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const persistSettings = async (nextSettings) => {
    const normalized = normalizeSettings(nextSettings);
    setSettings(normalized);
    try {
      await API.put("/crm-settings/me", normalized);
    } catch (err) {
      console.error(err);
    }
  };

  const updateNotificationPreference = (channel, key, value) => {
    persistSettings({
      ...settings,
      [`${channel}Notifications`]: {
        ...settings[`${channel}Notifications`],
        [key]: value,
      },
    });
  };

  const updateReminderOptions = (nextOptions) => {
    persistSettings({
      ...settings,
      reminderOptions: normalizeReminderOptions(nextOptions),
    });
  };

  if (loading) return <div className="settings-loading">Loading settings...</div>;

  const activeChannelKey = `${activeTab}Notifications`;
  const activeChannelSettings = settings?.[activeChannelKey] || DEFAULT_CHANNEL_PREFERENCES;
  const reminderOptions = normalizeReminderOptions(settings.reminderOptions);

  return (
    <div className="settings-container">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-header-main">
            <div className="settings-header-icon">
              <img src={reminderIcon} alt="Notification preferences" />
            </div>
            <div>
              <div className="settings-title">Notification Preferences</div>
              <div className="settings-subtitle">
                Choose which modules send app alerts and which send emails for your account.
              </div>
            </div>
          </div>
        </div>

        <div className="settings-tabs">
          {CHANNEL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </button>
          ))}
        </div>

        <div className="settings-panel">
          <div className="settings-section-label">
            {CHANNEL_TABS.find((tab) => tab.id === activeTab)?.label}
          </div>
          <div className="settings-panel-subtext">
            Turn individual modules on or off for this delivery channel.
          </div>

          <div className="settings-module-list">
            {MODULE_OPTIONS.map((item) => (
              <div className="settings-module-row" key={item.key}>
                <div className="settings-module-copy">
                  <div className="settings-module-title">{item.label}</div>
                  <div className="settings-module-description">{item.description}</div>
                </div>
                <div className="settings-module-toggle">
                  <span className="settings-module-state">
                    {activeChannelSettings[item.key] ? "On" : "Off"}
                  </span>
                  <div
                    className={`toggle-switch ${activeChannelSettings[item.key] ? "active" : ""}`}
                    onClick={() =>
                      updateNotificationPreference(
                        activeTab,
                        item.key,
                        !activeChannelSettings[item.key]
                      )
                    }
                  >
                    <div className="toggle-knob" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-panel settings-panel--reminders">
          <div className="settings-reminder-header">
            <div>
              <div className="settings-section-label">Reminder Offsets</div>
              <div className="settings-panel-subtext">
                Shared timing for scheduled follow-up and meeting reminders. The default reminder is 10 minutes before the activity.
              </div>
            </div>
          </div>

          <div className="settings-reminder-scroll">
            <ReminderOptionsEditor
              options={reminderOptions}
              onChange={updateReminderOptions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReminderOptionsEditor({ options, onChange }) {
  const updateRow = (index, key, value) => {
    const next = options.map((row, i) =>
      i !== index
        ? row
        : {
            ...row,
            [key]: key === "value" ? Math.max(1, Number(value) || 1) : value,
          }
    );
    onChange(next);
  };

  const removeRow = (index) => {
    const next = options.filter((_, i) => i !== index);
    onChange(next.length ? next : [...DEFAULT_REMINDER_OPTIONS]);
  };

  const addRow = () => {
    onChange([...options, { value: 10, unit: "minutes" }]);
  };

  return (
    <div className="reminder-options-panel">
      {options.map((row, index) => (
        <div className="reminder-option-row" key={`setting-reminder-${index}`}>
          <input
            className="reminder-option-number"
            type="number"
            min="1"
            value={row.value}
            onChange={(e) => updateRow(index, "value", e.target.value)}
          />
          <select
            className="reminder-option-unit"
            value={row.unit}
            onChange={(e) => updateRow(index, "unit", e.target.value)}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          {index > 0 ? (
            <button
              type="button"
              className="reminder-option-remove"
              onClick={() => removeRow(index)}
              title="Remove row"
            >
              x
            </button>
          ) : (
            <div className="reminder-option-remove-spacer" />
          )}
        </div>
      ))}
      <button type="button" className="reminder-option-add" onClick={addRow}>
        + Add reminder
      </button>
    </div>
  );
}
