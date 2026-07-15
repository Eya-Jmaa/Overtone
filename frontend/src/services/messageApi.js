const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options = {}, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
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

export async function getMessages(token, convId) {
  return request(`/conversations/${convId}/messages`, { method: "GET" }, token);
}

export async function sendMessage(token, convId, content, audioUrl = null, audioDuration = null) {
  return request(
    `/conversations/${convId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, audio_url: audioUrl, audio_duration: audioDuration }),
    },
    token,
  );
}

export async function transcribeAudio(token, audioBlob, filename = "recording.webm") {
  const form = new FormData();
  form.append("audio", audioBlob, filename);

  const res = await fetch(`${API_URL}/transcribe/`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Transcription failed (${res.status})`);
  }
  return res.json();
}

export async function uploadAudio(token, audioBlob, filename = "recording.webm") {
  const form = new FormData();
  form.append("audio", audioBlob, filename);

  const res = await fetch(`${API_URL}/audio/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Audio upload failed (${res.status})`);
  }
  return res.json();
}
