import { useState, useEffect } from "react";

const API_BASE = "/api/crm-settings";

// Inject fonts & keyframes once
if (typeof document !== "undefined") {
  if (!document.getElementById("crm-settings-styles")) {
    const style = document.createElement("style");
    style.id = "crm-settings-styles";
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=DM+Mono:wght@400;500&display=swap');
      @keyframes crm-spin { to { transform: rotate(360deg); } }
      @keyframes crm-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      @keyframes crm-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      .crm-settings-root * { box-sizing: border-box; }
      .crm-settings-root button { border: none; cursor: pointer; }
      .crm-settings-root button:focus { outline: none; }
      .crm-settings-root input:focus { outline: none; }
      .crm-settings-root input::placeholder { color: #374151; }
      .crm-ai-row:hover { background: rgba(255,255,255,.025) !important; }
      .crm-int-row:hover { background: rgba(255,255,255,.025) !important; }
    `;
    document.head.appendChild(style);
  }
}

/* ── Toggle ── */
const Toggle = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    style={{
      width: 46, height: 24, borderRadius: 12, flexShrink: 0,
      background: enabled ? "linear-gradient(90deg,#6c47ff,#9f7aea)" : "#1a1a2e",
      border: `1.5px solid ${enabled ? "transparent" : "#2a2a3e"}`,
      position: "relative", transition: "all .25s",
      boxShadow: enabled ? "0 0 14px #6c47ff55" : "none",
    }}
  >
    <span style={{
      position: "absolute", top: 3, width: 16, height: 16, borderRadius: "50%",
      background: "#fff", transition: "left .25s", boxShadow: "0 1px 4px #0007",
      left: enabled ? 25 : 3,
    }} />
  </button>
);

/* ── Chip ── */
const Chip = ({ label, color }) => {
  const c = {
    violet: ["#6c47ff20","#6c47ff55","#a78bfa"],
    amber:  ["#f59e0b20","#f59e0b55","#fbbf24"],
    teal:   ["#14b8a620","#14b8a655","#2dd4bf"],
  }[color] || ["#6c47ff20","#6c47ff55","#a78bfa"];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
      padding: "2px 8px", borderRadius: 20,
      background: c[0], border: `1px solid ${c[1]}`, color: c[2],
    }}>{label}</span>
  );
};

/* ── Status pill ── */
const StatusPill = ({ connected }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
    padding: "3px 10px", borderRadius: 20,
    background: connected ? "#10b98118" : "#ffffff0a",
    border: `1px solid ${connected ? "#10b98140" : "#ffffff18"}`,
    color: connected ? "#34d399" : "#4b5563",
  }}>
    <span style={{
      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
      background: connected ? "#34d399" : "#374151",
      boxShadow: connected ? "0 0 6px #34d399" : "none",
      animation: connected ? "crm-pulse 2s ease-in-out infinite" : "none",
    }} />
    {connected ? "Connected" : "Disconnected"}
  </span>
);

/* ── Divider ── */
const Divider = () => (
  <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "0 20px" }} />
);

/* ── Section header ── */
const SectionHeader = ({ icon, title, subtitle, accentColor }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12,
    padding: "16px 20px 14px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
    background: `linear-gradient(90deg, ${accentColor}08, transparent)`,
  }}>
    <div style={{
      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
      background: `${accentColor}15`,
      border: `1px solid ${accentColor}35`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: `0 0 12px ${accentColor}30`,
      fontSize: 16,
    }}>{icon}</div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-.01em" }}>{title}</div>
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 1 }}>{subtitle}</div>
    </div>
  </div>
);

/* ── Card ── */
const Card = ({ children, style }) => (
  <div style={{
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 18,
    overflow: "hidden",
    backdropFilter: "blur(12px)",
    animation: "crm-fadein .4s ease",
    ...style,
  }}>{children}</div>
);

/* ── Main ── */
export default function CRMSettings() {
  const [s, setS] = useState({
    smartFollowupRemindersEnabled: false,
    aiLeadScoringEnabled: false,
    predictiveAnalyticsEnabled: false,
    reminderMethodInApp: true,
    reminderMethodEmail: false,
    reminderMethodWhatsApp: false,
    reminderTiming: "30min",
    whatsAppBusinessConnected: false,
    whatsAppBusinessAccountId: "",
    gmailConnected: true,
    Email_id: "user@example.com",
    googleCalendarConnected: false,
    calendarAccountEmail: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { msg, type }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(API_BASE);
        if (r.ok) setS(await r.json());
      } catch {}
      setLoading(false);
    })();
  }, []);

  const upd = (k, v) => setS(p => ({ ...p, [k]: v }));

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(API_BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (r.ok) showToast("Settings saved successfully");
      else showToast("Failed to save settings", "error");
    } catch {
      showToast("Network error — try again", "error");
    }
    setSaving(false);
  };

  const timings = [
    { v: "15min", l: "15 minutes before", icon: "⏱" },
    { v: "30min", l: "30 minutes before", icon: "🕐" },
    { v: "1hr",   l: "1 hour before",     icon: "⏰" },
    { v: "1day",  l: "1 day before",      icon: "📆" },
  ];

  if (loading) return (
    <div className="crm-settings-root" style={root}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"60vh", gap:16 }}>
        <div style={{ width:36, height:36, borderRadius:"50%", border:"3px solid #6c47ff33", borderTopColor:"#a78bfa", animation:"crm-spin .7s linear infinite" }} />
        <span style={{ color:"#4b5563", fontSize:13 }}>Loading settings…</span>
      </div>
    </div>
  );

  return (
    <div className="crm-settings-root" style={root}>

      {/* Ambient grid */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        backgroundImage:"linear-gradient(rgba(108,71,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(108,71,255,.03) 1px,transparent 1px)",
        backgroundSize:"44px 44px",
      }} />

      {/* Ambient glow blobs */}
      <div style={{ position:"fixed", top:-120, right:-80, width:360, height:360, borderRadius:"50%", background:"#6c47ff", opacity:.06, filter:"blur(80px)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", bottom:-100, left:-60, width:280, height:280, borderRadius:"50%", background:"#14b8a6", opacity:.05, filter:"blur(80px)", pointerEvents:"none", zIndex:0 }} />

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:24, right:24, zIndex:999,
          padding:"12px 18px", borderRadius:12, fontSize:13, fontWeight:600,
          background: toast.type === "error" ? "#ef444420" : "#10b98120",
          border: `1px solid ${toast.type === "error" ? "#ef444455" : "#10b98155"}`,
          color: toast.type === "error" ? "#f87171" : "#34d399",
          backdropFilter:"blur(12px)",
          animation:"crm-fadein .3s ease",
          boxShadow:"0 8px 32px #00000044",
        }}>
          {toast.type === "error" ? "✕ " : "✓ "}{toast.msg}
        </div>
      )}

      <div style={{ position:"relative", zIndex:1, maxWidth:760, margin:"0 auto", padding:"32px 20px 80px" }}>

        {/* ── Page title ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28, flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{
              width:42, height:42, borderRadius:13,
              background:"linear-gradient(135deg,#6c47ff22,#a78bfa11)",
              border:"1px solid #6c47ff40",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 0 20px #6c47ff30",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </div>
            <div>
              <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:"#f1f5f9", letterSpacing:"-.02em" }}>
                CRM Settings
              </h1>
              <p style={{ margin:0, fontSize:11, color:"#4b5563", marginTop:2 }}>
                AI, notifications & integrations
              </p>
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            style={{
              display:"flex", alignItems:"center", gap:8,
              padding:"10px 22px", borderRadius:12,
              background: "linear-gradient(90deg,#6c47ff,#9f7aea)",
              color:"#fff", fontSize:13, fontWeight:700,
              transition:"all .2s", opacity: saving ? .7 : 1,
              boxShadow:"0 4px 20px #6c47ff44",
              border:"none",
            }}
          >
            {saving
              ? <span style={{ width:14, height:14, borderRadius:"50%", border:"2px solid #ffffff55", borderTopColor:"#fff", animation:"crm-spin .6s linear infinite", display:"inline-block" }} />
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            }
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>

        {/* ════════ 1. AI & AUTOMATION ════════ */}
        <Card style={{ marginBottom:16 }}>
          <SectionHeader
            icon="✦"
            title="AI & Automation"
            subtitle="Intelligent features powered by machine learning"
            accentColor="#6c47ff"
          />

          {/* Smart Follow-up */}
          <div className="crm-ai-row" style={aiRow}>
            <div style={{ ...iconBox, background:"linear-gradient(135deg,#6c47ff,#9f7aea)" }}>🧠</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={aiTitle}>Smart Follow-up Reminders</span>
                <Chip label="Recommended" color="violet" />
              </div>
              <p style={aiDesc}>Let AI analyse engagement patterns and suggest the perfect moment to follow up—never let a warm lead go cold again.</p>
            </div>
            <Toggle enabled={s.smartFollowupRemindersEnabled} onChange={v => upd("smartFollowupRemindersEnabled", v)} />
          </div>

          <Divider />

          {/* Lead Scoring */}
          <div className="crm-ai-row" style={aiRow}>
            <div style={{ ...iconBox, background:"linear-gradient(135deg,#f59e0b,#ef4444)" }}>⚡</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={aiTitle}>AI Lead Scoring</span>
                <Chip label="Popular" color="amber" />
              </div>
              <p style={aiDesc}>Automatically rank and prioritise every lead so your sales team focuses energy on the highest-value opportunities.</p>
            </div>
            <Toggle enabled={s.aiLeadScoringEnabled} onChange={v => upd("aiLeadScoringEnabled", v)} />
          </div>

          <Divider />

          {/* Predictive Analytics */}
          <div className="crm-ai-row" style={aiRow}>
            <div style={{ ...iconBox, background:"linear-gradient(135deg,#14b8a6,#6c47ff)" }}>📈</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={aiTitle}>Predictive Analytics</span>
                <Chip label="Pro" color="teal" />
              </div>
              <p style={aiDesc}>Revenue forecasting, pipeline health scores, and deal intelligence—ML-powered insights baked directly into your workflow.</p>
            </div>
            <Toggle enabled={s.predictiveAnalyticsEnabled} onChange={v => upd("predictiveAnalyticsEnabled", v)} />
          </div>
        </Card>

        {/* ════════ 2. NOTIFICATIONS ════════ */}
        <Card style={{ marginBottom:16 }}>
          <SectionHeader
            icon="◎"
            title="Notifications"
            subtitle="Control how and when reminders reach you"
            accentColor="#f59e0b"
          />

          <div style={{ padding:"18px 20px 6px" }}>

            {/* Method */}
            <p style={subLabel}>Reminder Method</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:22 }}>
              {[
                { k:"reminderMethodInApp",    icon:"💬", label:"In-App"   },
                { k:"reminderMethodEmail",    icon:"📧", label:"Email"    },
                { k:"reminderMethodWhatsApp", icon:"💚", label:"WhatsApp" },
              ].map(m => {
                const on = s[m.k];
                return (
                  <button
                    key={m.k}
                    onClick={() => upd(m.k, !on)}
                    style={{
                      display:"flex", flexDirection:"column", alignItems:"center", gap:8,
                      padding:"16px 10px", borderRadius:14, transition:"all .2s",
                      background: on ? "#6c47ff18" : "#ffffff07",
                      border: `1.5px solid ${on ? "#6c47ff" : "#ffffff12"}`,
                      boxShadow: on ? "0 0 18px #6c47ff25" : "none",
                      position:"relative",
                    }}
                  >
                    <span style={{ fontSize:24 }}>{m.icon}</span>
                    <span style={{ fontSize:12, fontWeight:600, color: on ? "#c4b5fd" : "#4b5563" }}>{m.label}</span>
                    {on && (
                      <span style={{
                        position:"absolute", top:10, right:10,
                        width:7, height:7, borderRadius:"50%",
                        background:"#a78bfa", boxShadow:"0 0 8px #a78bfa",
                        animation:"crm-pulse 2s ease-in-out infinite",
                      }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Timing */}
            <p style={subLabel}>Reminder Frequency</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, paddingBottom:18 }}>
              {timings.map(t => {
                const on = s.reminderTiming === t.v;
                return (
                  <button
                    key={t.v}
                    onClick={() => upd("reminderTiming", t.v)}
                    style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"11px 14px", borderRadius:12, transition:"all .2s",
                      background: on ? "#6c47ff18" : "#ffffff07",
                      border: `1.5px solid ${on ? "#6c47ff" : "#ffffff12"}`,
                      color: on ? "#c4b5fd" : "#4b5563",
                      fontSize:12, fontWeight:500,
                    }}
                  >
                    <span style={{
                      width:14, height:14, borderRadius:"50%", flexShrink:0,
                      border: `2px solid ${on ? "#a78bfa" : "#374151"}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      boxShadow: on ? "0 0 8px #6c47ff" : "none",
                      transition:"all .2s",
                    }}>
                      {on && <span style={{ width:6, height:6, borderRadius:"50%", background:"#a78bfa" }} />}
                    </span>
                    <span style={{ fontSize:16 }}>{t.icon}</span>
                    {t.l}
                  </button>
                );
              })}
            </div>

          </div>
        </Card>

        {/* ════════ 3. INTEGRATIONS ════════ */}
        <Card>
          <SectionHeader
            icon="⬡"
            title="Integrations"
            subtitle="Connect your tools and centralise your workflow"
            accentColor="#14b8a6"
          />

          {/* WhatsApp */}
          <IntegrationRow
            icon="💬"
            grad="linear-gradient(135deg,#25d366,#128c7e)"
            title="WhatsApp Business"
            desc="Send messages and follow-ups directly from your CRM inbox without switching apps."
            connected={s.whatsAppBusinessConnected}
            onToggle={() => upd("whatsAppBusinessConnected", !s.whatsAppBusinessConnected)}
            fieldLabel="Account ID"
            fieldValue={s.whatsAppBusinessAccountId}
            onFieldChange={v => upd("whatsAppBusinessAccountId", v)}
            placeholder="Enter WhatsApp Business Account ID"
          />

          <Divider />

          {/* Gmail */}
          <IntegrationRow
            icon="✉️"
            grad="linear-gradient(135deg,#ea4335,#fbbc04)"
            title="Gmail"
            desc="Sync emails automatically, track opens, and manage conversations from one place."
            connected={s.gmailConnected}
            onToggle={() => upd("gmailConnected", !s.gmailConnected)}
            fieldLabel="Gmail Address"
            fieldValue={s.Email_id}
            onFieldChange={v => upd("Email_id", v)}
            placeholder="you@gmail.com"
          />

          <Divider />

          {/* Google Calendar */}
          <IntegrationRow
            icon="📅"
            grad="linear-gradient(135deg,#4285f4,#34a853)"
            title="Google Calendar"
            desc="Sync meetings, set reminders, and never miss a follow-up with two-way calendar sync."
            connected={s.googleCalendarConnected}
            onToggle={() => upd("googleCalendarConnected", !s.googleCalendarConnected)}
            fieldLabel="Calendar Email"
            fieldValue={s.calendarAccountEmail}
            onFieldChange={v => upd("calendarAccountEmail", v)}
            placeholder="calendar@gmail.com"
          />
        </Card>

      </div>
    </div>
  );
}

/* ─── Integration Row sub-component ─── */
function IntegrationRow({ icon, grad, title, desc, connected, onToggle, fieldLabel, fieldValue, onFieldChange, placeholder }) {
  return (
    <div className="crm-int-row" style={{ padding:"18px 20px", transition:"background .15s" }}>
      <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
        <div style={{ ...iconBox, background:grad, flexShrink:0 }}>{icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:5, flexWrap:"wrap" }}>
            <span style={aiTitle}>{title}</span>
            <StatusPill connected={connected} />
          </div>
          <p style={{ ...aiDesc, marginBottom: connected ? 12 : 0 }}>{desc}</p>

          {connected && (
            <div>
              <p style={{ ...subLabel, marginBottom:6 }}>{fieldLabel}</p>
              <input
                type="text"
                value={fieldValue}
                onChange={e => onFieldChange(e.target.value)}
                placeholder={placeholder}
                style={{
                  width:"100%", background:"#ffffff08",
                  border:"1px solid rgba(255,255,255,.1)", borderRadius:10,
                  padding:"9px 12px", fontSize:12, color:"#d1d5db",
                  fontFamily:"'DM Mono', monospace", transition:"border-color .2s",
                  maxWidth:360,
                }}
                onFocus={e => e.target.style.borderColor = "#6c47ff"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,.1)"}
              />
            </div>
          )}
        </div>

        <button
          onClick={onToggle}
          style={{
            flexShrink:0, padding:"8px 16px", borderRadius:10,
            fontSize:11, fontWeight:700, letterSpacing:".04em", transition:"all .2s",
            color: connected ? "#f87171" : "#a78bfa",
            border: `1px solid ${connected ? "#f8717133" : "#a78bfa44"}`,
            background: connected ? "#f8717110" : "#a78bfa10",
          }}
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}

/* ─── Shared style tokens ─── */
const root = {
  minHeight: "100vh",
  background: "#080810",
  fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  color: "#e2e8f0",
  position: "relative",
};

const iconBox = {
  width: 42, height: 42, borderRadius: 12,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 20, boxShadow: "0 4px 14px rgba(0,0,0,.4)", flexShrink: 0,
};

const aiRow = {
  display: "flex", alignItems: "center", gap: 14,
  padding: "16px 20px", transition: "background .15s",
};

const aiTitle = {
  fontSize: 13, fontWeight: 700, color: "#e2e8f0",
};

const aiDesc = {
  fontSize: 11, color: "#4b5563", lineHeight: 1.65, margin: 0,
};

const subLabel = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
  textTransform: "uppercase", color: "#374151", marginBottom: 10, margin: "0 0 10px",
};
