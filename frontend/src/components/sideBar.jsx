import "./sideBar.css";

const menuItems = [
  { name: "My Dashboard", icon: "📊", active: true },
  { name: "Follow-ups", icon: "⏰" },
  { name: "Leads", icon: "🎯" },
  { name: "Sales Forecasting", icon: "📈" },
  { name: "Expenses", icon: "💰" },
  { name: "AI Lead Gen", icon: "🤖" },
  { name: "Events & Expos", icon: "🎪" },
  { name: "Team Dashboard", icon: "👥" },
  { name: "Reports", icon: "📄" },
  { name: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  return (
    <div className="sidebar">

      <div className="sidebar-header">
        <div className="sidebar-logo">AbhinavDCS CRM</div>
        <div className="sidebar-subtitle">
          AI-Powered Sales Platform
        </div>
      </div>

      <div className="sidebar-divider"></div>

      <div className="sidebar-menu">
        {menuItems.map((item, index) => (
          <div
            key={index}
            className={`sidebar-item ${item.active ? "active" : ""}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-text">{item.name}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
