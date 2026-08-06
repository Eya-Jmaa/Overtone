import { useToastStore } from "../stores/toastStore.js";

const TYPE_STYLES = {
  success: { borderLeft: "2px solid var(--sage)", color: "var(--sage)" },
  error: { borderLeft: "2px solid var(--rose)", color: "var(--rose)" },
  info: { borderLeft: "2px solid var(--gold)", color: "var(--bone)" },
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 32,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          style={{
            ...TYPE_STYLES[toast.type] || TYPE_STYLES.info,
            pointerEvents: "auto",
            cursor: "pointer",
            position: "relative",
          }}
          onClick={() => remove(toast.id)}
          role="alert"
        >
          <span style={{ fontSize: 13 }}>{toast.message}</span>
          <button
            onClick={(e) => { e.stopPropagation(); remove(toast.id); }}
            aria-label="Dismiss notification"
            style={{
              position: "absolute",
              top: 4,
              right: 8,
              background: "none",
              border: "none",
              color: "var(--bone-faint)",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
