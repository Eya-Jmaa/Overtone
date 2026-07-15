import { Outlet } from "react-router-dom";
import { useState, useEffect } from "react";
import Sidebar from "../components/sidebar/Sidebar.jsx";
import ToastContainer from "../components/Toast.jsx";

export default function AppLayout() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("sidebarOpen") !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sidebarOpen", String(open));
    } catch {}
  }, [open]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--ink)" }}>
      {/* Collapsible sidebar (animated width) */}
      <div
        style={{
          width: open ? 260 : 0,
          flexShrink: 0,
          overflow: "hidden",
          transition: "width 320ms cubic-bezier(.2,.7,.2,1)",
        }}
      >
        <Sidebar onCollapse={() => setOpen(false)} />
      </div>

      {/* Floating reopen button when collapsed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Open sidebar"
          aria-label="Open sidebar"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 40,
            width: 38,
            height: 38,
            borderRadius: 10,
            border: "1px solid var(--whisper-2)",
            background: "var(--ink-2)",
            color: "var(--bone-dim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            animation: "fadeIn 200ms ease both",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--gold)";
            e.currentTarget.style.borderColor = "var(--gold)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--bone-dim)";
            e.currentTarget.style.borderColor = "var(--whisper-2)";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      )}

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
          height: "100%",
          position: "relative",
        }}
      >
        <Outlet />
        <ToastContainer />
      </main>
    </div>
  );
}
