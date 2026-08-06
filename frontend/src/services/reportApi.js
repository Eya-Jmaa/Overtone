const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options = {}, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function endSession(id, token) {
  return request(`/conversations/${id}/end`, { method: "POST" }, token);
}

export async function getReport(id, token) {
  return request(`/conversations/${id}/report`, { method: "GET" }, token);
}
