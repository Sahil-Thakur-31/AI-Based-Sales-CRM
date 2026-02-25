import { useNavigate } from "react-router-dom";

function BackButton() {
  const navigate = useNavigate();

  return (
    <a
      onClick={() => navigate(-1)}
      style={{
        marginBottom: "10px",
        padding: "6px 12px",
        cursor: "pointer"
      }}
    >
      ← Back 
    </a>
  );
}

export default BackButton;
