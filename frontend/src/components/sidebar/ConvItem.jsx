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

  // Check if this conversation is currently displayed in the conversation panel
  const isCurrentlyOpen = location.pathname === `/app/${conv.id}`;
  const hasUnread = false; // TODO: wire when backend supports read tracking

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
          borderRadius: 6,
          marginBottom: 2,
          borderLeft: `2px solid ${isActive ? "var(--gold)" : "transparent"}`,
          background: isActive
            ? "var(--gold-soft)"
            : hovered
            ? "rgba(212,165,116,0.05)"
            : "transparent",
          textDecoration: "none",
          color: "inherit",
          transition: "background 180ms cubic-bezier(.2,.7,.2,1), border-color 180ms cubic-bezier(.2,.7,.2,1), transform 180ms cubic-bezier(.2,.7,.2,1)",
          transform: hovered && !isActive ? "translateX(2px)" : "translateX(0)",
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

              {/* Delete button — visible on hover */}
              {hovered && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowConfirm(true);
                  }}
                  title="Delete conversation"
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    borderRadius: 4,
                    background: "transparent",
                    color: "var(--bone-faint)",
                    fontSize: 13,
                    lineHeight: 1,
                    cursor: "pointer",
                    opacity: 0.6,
                    transition: "opacity 150ms, color 150ms, background 150ms",
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.color = "#ef4444";
                    e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.6";
                    e.currentTarget.style.color = "var(--bone-faint)";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  ✕
                </button>
              )}
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

      {/* Confirmation overlay */}
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
