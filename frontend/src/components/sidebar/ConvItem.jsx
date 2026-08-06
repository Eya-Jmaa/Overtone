import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore.js";
import { useConvStore } from "../../stores/convStore.js";
import ModeTag from "../topbar/ModeTag.jsx";
import { relativeTime } from "../../utils/time.js";

export default function ConvItem({ conv }) {
  const [hovered, setHovered] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.accessToken);
  const deleteConversation = useConvStore((s) => s.deleteConversation);

  const isCurrentlyOpen = location.pathname === `/app/${conv.id}`;
  const hasUnread = false;

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    const ok = await deleteConversation(conv.id, token);
    setDeleting(false);
    setShowConfirm(false);
    if (ok && isCurrentlyOpen) {
      navigate("/app", { replace: true });
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <NavLink
        to={`/app/${conv.id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={({ isActive }) => ({
          display: "block",
          padding: "9px 12px 9px 10px",
          borderRadius: 8,
          marginBottom: 3,
          borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
          border: `1px solid ${isActive ? "var(--border)" : "transparent"}`,
          borderLeftWidth: 2,
          borderLeftColor: isActive ? "var(--accent)" : "transparent",
          background: isActive
            ? "var(--bg-elevated)"
            : hovered
            ? "var(--bg-surface)"
            : "transparent",
          boxShadow: isActive ? "var(--edge-light), var(--shadow-sm)" : "none",
          textDecoration: "none",
          color: "inherit",
          transition: "background 180ms var(--ease), border-color 180ms var(--ease), transform 180ms var(--ease), box-shadow 180ms",
          transform: hovered && !isActive ? "translateX(3px)" : "translateX(0)",
        })}
      >
        {({ isActive }) => (
          <>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 5,
              gap: 8,
            }}>
              <span style={{
                fontSize: 13,
                fontWeight: 500,
                color: isActive ? "var(--bone)" : hovered ? "var(--bone)" : "var(--bone-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "color 180ms",
                lineHeight: 1.3,
                flex: 1,
              }}>
                {conv.title}
              </span>

              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowConfirm(true);
                }}
                title="Delete conversation"
                aria-label={`Delete conversation ${conv.title}`}
                tabIndex={hovered ? 0 : -1}
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  borderRadius: 5,
                  background: "transparent",
                  color: "var(--text-faint)",
                  lineHeight: 1,
                  cursor: "pointer",
                  opacity: hovered ? 0.75 : 0,
                  pointerEvents: hovered ? "auto" : "none",
                  transform: hovered ? "scale(1)" : "scale(.8)",
                  transition: "opacity 160ms, color 150ms, background 150ms, transform 180ms var(--ease-back)",
                  padding: 0,
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.color = "var(--rose)";
                  e.currentTarget.style.background = "color-mix(in srgb, var(--rose) 16%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.75";
                  e.currentTarget.style.color = "var(--text-faint)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
                </svg>
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {hasUnread && (
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--gold)",
                    flexShrink: 0,
                  }} />
                )}
                <ModeTag mode={conv.mode} size="sm" />
              </div>
              <span style={{
                fontSize: 10,
                color: "var(--bone-faint)",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {relativeTime(conv.created_at)}
              </span>
            </div>
          </>
        )}
      </NavLink>

      {showConfirm && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowConfirm(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,11,16,0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 360,
              background: "var(--ink-2)",
              border: "1px solid var(--whisper-2)",
              borderRadius: 12,
              padding: "28px 24px 24px",
              animation: "fadeUp 300ms cubic-bezier(.2,.7,.2,1) both",
              textAlign: "center",
            }}
          >
            <div style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 17,
              fontWeight: 500,
              color: "var(--bone)",
              marginBottom: 6,
            }}>
              Delete this conversation?
            </div>
            <div style={{
              fontSize: 13,
              color: "var(--bone-dim)",
              lineHeight: 1.6,
              marginBottom: 24,
            }}>
              This action cannot be undone. All messages will be permanently removed.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirm(false);
                }}
                disabled={deleting}
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  border: "1px solid var(--whisper-2)",
                  background: "transparent",
                  color: "var(--bone-dim)",
                  fontSize: 13,
                  cursor: deleting ? "wait" : "pointer",
                  fontFamily: "inherit",
                  transition: "all 200ms",
                }}
                onMouseEnter={(e) => {
                  if (!deleting) {
                    e.currentTarget.style.borderColor = "var(--whisper)";
                    e.currentTarget.style.color = "var(--bone)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--whisper-2)";
                  e.currentTarget.style.color = "var(--bone-dim)";
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: deleting ? "var(--bone-faint)" : "#ef4444",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: deleting ? "wait" : "pointer",
                  fontFamily: "inherit",
                  transition: "all 200ms",
                }}
                onMouseEnter={(e) => {
                  if (!deleting) {
                    e.currentTarget.style.boxShadow = "0 0 20px 3px rgba(239,68,68,0.35)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!deleting) {
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
