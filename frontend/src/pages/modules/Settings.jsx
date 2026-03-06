import { useEffect, useState } from "react";
import API from "../../api";
import "./styles/Settings.css";
import robotIcon from "../../assets/settings/robot_16109533.png";
import reminderIcon from "../../assets/settings/reminder_18312774.png";
import leadScoreIcon from "../../assets/settings/benchmarking_16744074.png";
import predictiveIcon from "../../assets/settings/predictive-chart_18263705.png";
import notifyIcon from "../../assets/settings/notification_6048479.png";

const DEFAULT_REMINDER_OPTIONS = [{ value: 10, unit: "minutes" }];

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

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await API.get("/crm-settings/me");
      setSettings({
        ...res.data,
        reminderOptions: normalizeReminderOptions(res.data?.reminderOptions),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const update = async (field, value) => {
    const updated = { ...settings, [field]: value };
    setSettings(updated);
    try {
      await API.put("/crm-settings/me", updated);
    } catch (err) {
      console.error(err);
    }
  };

  const updateReminderOptions = async (nextOptions) => {
    const normalized = normalizeReminderOptions(nextOptions);
    const updated = { ...settings, reminderOptions: normalized };
    setSettings(updated);
    try {
      await API.put("/crm-settings/me", updated);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="settings-loading">Loading settings...</div>;

  const reminderOptions = normalizeReminderOptions(settings.reminderOptions);

  return (
    <div className="settings-container">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-header-icon">
            <img src={robotIcon} alt="AI automation" />
          </div>
          <div>
            <div className="settings-title">AI & Automation</div>
            <div className="settings-subtitle">Intelligent automation powered by machine learning</div>
          </div>
        </div>

        <ToggleRow
          icon={reminderIcon}
          title="Smart Follow-up Reminders"
          desc="Automatically suggest optimal follow-up timing"
          value={settings.smartFollowupRemindersEnabled}
          onChange={(v) => update("smartFollowupRemindersEnabled", v)}
        />

        <ToggleRow
          icon={leadScoreIcon}
          title="AI Lead Scoring"
          desc="Automatically prioritize leads based on engagement"
          value={settings.aiLeadScoringEnabled}
          onChange={(v) => update("aiLeadScoringEnabled", v)}
        />

        <ToggleRow
          icon={predictiveIcon}
          title="Predictive Analytics"
          desc="Forecast revenue and identify high-probability deals"
          value={settings.predictiveAnalyticsEnabled}
          onChange={(v) => update("predictiveAnalyticsEnabled", v)}
        />
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-header-icon">
            <img src={notifyIcon} alt="Notifications" />
          </div>
          <div>
            <div className="settings-title">Notifications</div>
            <div className="settings-subtitle">Control reminder delivery and offsets</div>
          </div>
        </div>

        <div className="settings-section-label">Reminder Method</div>
        <div className="method-grid">
          <MethodCard
            icon="App"
            title="In-App"
            active={settings.reminderMethodInApp}
            onClick={() => update("reminderMethodInApp", !settings.reminderMethodInApp)}
          />
          <MethodCard
            icon="Mail"
            title="Email"
            active={settings.reminderMethodEmail}
            onClick={() => update("reminderMethodEmail", !settings.reminderMethodEmail)}
          />
        </div>

        <div className="settings-section-label">Reminder Offsets</div>
        <ReminderOptionsEditor
          options={reminderOptions}
          onChange={updateReminderOptions}
        />
      </div>
    </div>
  );
}

function ToggleRow({ icon, title, desc, value, onChange }) {
  return (
    <div className="toggle-row">
      <div className="toggle-left">
        <div className="toggle-icon">
          <img src={icon} alt="" />
        </div>
        <div>
          <div className="toggle-title">{title}</div>
          <div className="toggle-desc">{desc}</div>
        </div>
      </div>

      <div
        className={`toggle-switch ${value ? "active" : ""}`}
        onClick={() => onChange(!value)}
      >
        <div className="toggle-knob" />
      </div>
    </div>
  );
}

function MethodCard({ icon, title, active, onClick }) {
  return (
    <div className={`method-card ${active ? "active" : ""}`} onClick={onClick}>
      <div className="method-icon">{icon}</div>
      <div className="method-title">{title}</div>
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
          <div className="reminder-option-label">Notify</div>
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
          <button
            type="button"
            className="reminder-option-remove"
            onClick={() => removeRow(index)}
            title="Remove row"
          >
            x
          </button>
        </div>
      ))}
      <button type="button" className="reminder-option-add" onClick={addRow}>
        + Add reminder
      </button>
    </div>
  );
}
