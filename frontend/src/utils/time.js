export function relativeTime(dateInput) {
  if (!dateInput) return "";
  const now = Date.now();
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;

  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "yesterday";
  if (diffD < 30) return `${diffD} days ago`;

  const diffM = Math.floor(diffD / 30);
  if (diffM < 12) return `${diffM} mo ago`;

  return date.toLocaleDateString();
}

export function formatTime(dateInput) {
  if (!dateInput) return "";
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
