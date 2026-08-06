const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function getAnalyticsOverview(token) {
  const res = await fetch(`${API_URL}/analytics/overview`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}
