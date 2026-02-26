import '../styles/statcard.css';

function StatCard({ 
  title = "", 
  value = 0, 
  sub = "", 
  badge = null, 
  icon = "📊", 
  color = "blue" 
}) {

  return (
    <div className={`stat-card ${color || "blue"}`}>

      <div className="icon">
        {icon || "📊"}
      </div>

      <h4>{title || "N/A"}</h4>

      <h2>
        {value !== undefined && value !== null ? value : "--"}
      </h2>

      <p>{sub || ""}</p>

      {badge && <span className="badge">{badge}</span>}

    </div>
  );
}

export default StatCard;
