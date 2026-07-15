// frontend/src/services/authApi.js
// REPLACE ENTIRELY

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

export async function sendCode(email) {
  return request("/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyCode(email, code) {
  return request("/auth/verify-code", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function completeSignup(signupToken, name, password) {
  return request("/auth/complete-signup", {
    method: "POST",
    body: JSON.stringify({ signup_token: signupToken, name, password }),
  });
}

export async function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshToken() {
  // Now returns { accessToken, user } instead of just { accessToken }
  return request("/auth/refresh", { method: "POST" });
}

export async function logout() {
  return request("/auth/logout", { method: "POST" });
}

export async function getMe(accessToken) {
  // Fetches the current user profile using the access token
  return request("/auth/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function googleLoginUrl() {
  return `${API_URL}/auth/google/login`;
}