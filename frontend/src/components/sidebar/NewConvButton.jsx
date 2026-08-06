import { useNavigate } from "react-router-dom";

export default function NewConvButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/app")}
      className="cta"
      style={{ fontSize: 13, padding: "11px 14px", borderRadius: 8 }}
    >
      + New conversation
    </button>
  );
}
