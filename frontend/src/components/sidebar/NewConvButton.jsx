import { useNavigate } from "react-router-dom";

/**
 * "New conversation" — jumps straight to the landing composer (/app), where the
 * mode is chosen inline and the conversation is created on the first message.
 */
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
