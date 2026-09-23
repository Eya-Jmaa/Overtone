import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { useAuthStore } from "../../stores/authStore.js";
import { useConvStore } from "../../stores/convStore.js";
import { useThemeStore } from "../../stores/themeStore.js";
import NewConvButton from "./NewConvButton.jsx";
import ConvItem from "./ConvItem.jsx";
import AmbientWave from "../auth/AmbientWave.jsx";

export default function Sidebar({ onCollapse }) {
  const { user, logout, accessToken } = useAuthStore();
  const { conversations, isLoading, loadConversations } = useConvStore();
  const { theme, toggle } = useThemeStore();

  useEffect(() => {
    if (accessToken) loadConversations(accessToken);
  }, [accessToken, loadConversations]);

  return (
    <aside style={{
      width: 260,
      flexShrink: 0,
      background: "var(--bg-sunken)",
      borderRight: "1px solid var(--border)",
      boxShadow: "inset -12px 0 24px -24px rgba(0,0,0,.9)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "relative",
      overflow: "hidden",
    }}>
      <AmbientWave />

      <div style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        <div style={{ padding: "22px 20px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="wordmark" style={{ fontSize: 18 }}>Overtone<span>.</span></div>
          <button
            onClick={onCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "transparent",
              border: "1px solid var(--whisper-2)",
              color: "var(--bone-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--gold)";
              e.currentTarget.style.borderColor = "var(--gold)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--bone-faint)";
              e.currentTarget.style.borderColor = "var(--whisper-2)";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "0 14px 10px" }}>
          <NewConvButton />
        </div>

        <div style={{ padding: "0 14px 14px" }}>
          <NavLink
            to="/app/dashboard"
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              padding: "9px 11px",
              borderRadius: 9,
              border: "1px solid var(--whisper-2)",
              background: isActive ? "var(--bg-elevated)" : "transparent",
              color: isActive ? "var(--text-base)" : "var(--text-muted)",
              fontSize: 12.5,
              textDecoration: "none",
              transition: "background 140ms, color 140ms",
            })}
          >
            <BarChart3 size={15} strokeWidth={1.7} />
            Your patterns
          </NavLink>
        </div>

        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 10px",
          borderTop: "1px solid var(--whisper-2)",
        }}>
          <div style={{
            padding: "12px 8px 8px",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--bone-faint)",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Recent
          </div>

          {isLoading && (
            <div style={{
              padding: "10px 8px",
              fontSize: 11,
              color: "var(--bone-faint)",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: 0.5,
            }}>
              Loading…
            </div>
          )}

          {!isLoading && conversations.length === 0 && (
            <div style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "var(--bone-faint)",
              lineHeight: 1.5,
            }}>
              No conversations yet
            </div>
          )}

          {conversations.map((c) => <ConvItem key={c.id} conv={c} />)}
        </div>

        <div style={{
          padding: "12px 14px",
          borderTop: "1px solid var(--whisper-2)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--gold-soft)",
            border: "1px solid rgba(212,165,116,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--gold)",
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}>
            {user?.name?.[0]?.toUpperCase() || "?"}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--bone)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {user?.name || "User"}
            </div>
            {user?.email && (
              <div style={{
                fontSize: 10,
                color: "var(--bone-faint)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {user.email}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={toggle}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: "transparent",
                border: "1px solid var(--whisper-2)",
                color: "var(--bone-faint)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 14,
                fontFamily: "inherit",
                transition: "border-color 200ms, color 200ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--gold)";
                e.currentTarget.style.color = "var(--gold)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--whisper-2)";
                e.currentTarget.style.color = "var(--bone-faint)";
              }}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>

            <button
              onClick={logout}
              title="Log out"
              aria-label="Log out"
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: "transparent",
                border: "1px solid var(--whisper-2)",
                color: "var(--bone-faint)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                transition: "border-color 200ms, color 200ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--gold)";
                e.currentTarget.style.color = "var(--gold)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--whisper-2)";
                e.currentTarget.style.color = "var(--bone-faint)";
              }}
            >
              ↪
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
