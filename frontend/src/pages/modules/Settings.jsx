import { useEffect, useState } from "react";
import API from "../../api";
import "./styles/Settings.css";

const DEFAULT_CUSTOM_REMINDER_OFFSET_MINUTES = 30;
const MAX_CUSTOM_REMINDER_OFFSET_MINUTES = 1439;

function normalizeCustomReminderOffsetMinutes(value) {

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_CUSTOM_REMINDER_OFFSET_MINUTES;
  }

  return Math.min(
    MAX_CUSTOM_REMINDER_OFFSET_MINUTES,
    Math.max(0, Math.round(numericValue))
  );

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
        customReminderOffsetMinutes: normalizeCustomReminderOffsetMinutes(
          res.data.customReminderOffsetMinutes
        )
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


  if (loading) return <div className="settings-loading">Loading settings...</div>;

  const customReminderOffsetMinutes = normalizeCustomReminderOffsetMinutes(
    settings.customReminderOffsetMinutes
  );

  const customReminderHours = Math.floor(customReminderOffsetMinutes / 60);
  const customReminderMinutes = customReminderOffsetMinutes % 60;

  const updateCustomReminderHours = (hoursValue) => {

    const nextOffset = normalizeCustomReminderOffsetMinutes(
      (Number(hoursValue) * 60) + customReminderMinutes
    );

    update("customReminderOffsetMinutes", nextOffset);

  };

  const updateCustomReminderMinutes = (minutesValue) => {

    const nextOffset = normalizeCustomReminderOffsetMinutes(
      (customReminderHours * 60) + Number(minutesValue)
    );

    update("customReminderOffsetMinutes", nextOffset);

  };



  return (

    <div className="settings-container">

      {/* AI AUTOMATION */}

      <div className="settings-card">

        <div className="settings-card-header">

          <div className="settings-header-icon">
            🤖
          </div>

          <div>

            <div className="settings-title">
              AI & Automation
            </div>

            <div className="settings-subtitle">
              Intelligent automation powered by machine learning
            </div>

          </div>

        </div>



        <ToggleRow
          icon="🧠"
          title="Smart Follow-up Reminders"
          desc="Automatically suggest optimal follow-up timing"
          value={settings.smartFollowupRemindersEnabled}
          onChange={(v)=>update("smartFollowupRemindersEnabled", v)}
        />



        <ToggleRow
          icon="⚡"
          title="AI Lead Scoring"
          desc="Automatically prioritize leads based on engagement"
          value={settings.aiLeadScoringEnabled}
          onChange={(v)=>update("aiLeadScoringEnabled", v)}
        />



        <ToggleRow
          icon="📊"
          title="Predictive Analytics"
          desc="Forecast revenue and identify high-probability deals"
          value={settings.predictiveAnalyticsEnabled}
          onChange={(v)=>update("predictiveAnalyticsEnabled", v)}
        />



        <ToggleRow
          icon="📅"
          title="Calendar Sync"
          desc="Sync reminders and meetings with your calendar"
          value={settings.calendarSyncEnabled}
          onChange={(v)=>update("calendarSyncEnabled", v)}
        />


      </div>




      {/* NOTIFICATIONS */}

      <div className="settings-card">


        <div className="settings-card-header">

          <div className="settings-header-icon">
            🔔
          </div>

          <div>

            <div className="settings-title">
              Notifications
            </div>

            <div className="settings-subtitle">
              Control how and when reminders reach you
            </div>

          </div>

        </div>



        <div className="settings-section-label">
          Reminder Method
        </div>


        <div className="method-grid">


          <MethodCard
            icon="💬"
            title="In-App"
            active={settings.reminderMethodInApp}
            onClick={()=>update("reminderMethodInApp", !settings.reminderMethodInApp)}
          />


          <MethodCard
            icon="✉️"
            title="Email"
            active={settings.reminderMethodEmail}
            onClick={()=>update("reminderMethodEmail", !settings.reminderMethodEmail)}
          />


          <MethodCard
            icon="📱"
            title="WhatsApp"
            active={settings.reminderMethodWhatsApp}
            onClick={()=>update("reminderMethodWhatsApp", !settings.reminderMethodWhatsApp)}
          />



        </div>




        <div className="settings-section-label">
          Reminder Timing
        </div>



        <div className="timing-grid">


          <TimingCard
            title="15 minutes before"
            active={settings.reminderTiming==="15min"}
            onClick={()=>update("reminderTiming","15min")}
          />


          <TimingCard
            title="30 minutes before"
            active={settings.reminderTiming==="30min"}
            onClick={()=>update("reminderTiming","30min")}
          />


          <TimingCard
            title="1 hour before"
            active={settings.reminderTiming==="1hr"}
            onClick={()=>update("reminderTiming","1hr")}
          />


          <TimingCard
            title={`Custom (${customReminderHours}h ${customReminderMinutes}m)`}
            active={settings.reminderTiming==="custom"}
            onClick={()=>update("reminderTiming","custom")}
          />


        </div>

        {settings.reminderTiming==="custom" && (
          <CustomTimingPanel
            hours={customReminderHours}
            minutes={customReminderMinutes}
            onHoursChange={updateCustomReminderHours}
            onMinutesChange={updateCustomReminderMinutes}
          />
        )}



      </div>


    </div>

  );

}




function ToggleRow({ icon, title, desc, value, onChange }) {

  return (

    <div className="toggle-row">

      <div className="toggle-left">

        <div className="toggle-icon">
          {icon}
        </div>

        <div>

          <div className="toggle-title">
            {title}
          </div>

          <div className="toggle-desc">
            {desc}
          </div>

        </div>

      </div>


      <div
        className={`toggle-switch ${value ? "active" : ""}`}
        onClick={()=>onChange(!value)}
      >
        <div className="toggle-knob"/>
      </div>


    </div>

  );

}



function CustomTimingPanel({ hours, minutes, onHoursChange, onMinutesChange }) {

  return (

    <div className="custom-timing-panel">

      <div className="custom-timing-title">
        How much time before?
      </div>

      <div className="custom-slider-row">

        <div className="custom-slider-header">
          <span>Hours</span>
          <span>{hours}h</span>
        </div>

        <input
          className="custom-slider"
          type="range"
          min="0"
          max="23"
          step="1"
          value={hours}
          onChange={(e)=>onHoursChange(e.target.value)}
        />

      </div>

      <div className="custom-slider-row">

        <div className="custom-slider-header">
          <span>Minutes</span>
          <span>{minutes}m</span>
        </div>

        <input
          className="custom-slider"
          type="range"
          min="0"
          max="59"
          step="1"
          value={minutes}
          onChange={(e)=>onMinutesChange(e.target.value)}
        />

      </div>

      <div className="custom-timing-preview">
        Reminder will trigger {hours}h {minutes}m before.
      </div>

    </div>

  );

}



function MethodCard({ icon, title, active, onClick }) {

  return (

    <div
      className={`method-card ${active ? "active" : ""}`}
      onClick={onClick}
    >

      <div className="method-icon">
        {icon}
      </div>

      <div className="method-title">
        {title}
      </div>

    </div>

  );

}



function TimingCard({ title, active, onClick }) {

  return (

    <div
      className={`timing-card ${active ? "active" : ""}`}
      onClick={onClick}
    >

      <div className="radio">
        {active && <div className="radio-dot"/>}
      </div>

      {title}

    </div>

  );

}
