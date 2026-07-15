/**
 * Skeleton loader for chat message bubbles.
 * Shows a pulsing placeholder matching the shape of a message bubble.
 */
export default function SkeletonMessage({ align = "left" }) {
  const width = 40 + Math.random() * 30;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        padding: "4px 0",
      }}
    >
      <div
        style={{
          width: `${width}%`,
          height: 48,
          borderRadius: 16,
          borderBottomRightRadius: align === "right" ? 4 : 16,
          borderBottomLeftRadius: align === "right" ? 16 : 4,
          background: "var(--ink-3)",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
    </div>
  );
}