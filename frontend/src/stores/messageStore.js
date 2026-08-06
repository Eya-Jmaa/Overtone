import { create } from "zustand";
import { getMessages, sendMessage } from "../services/messageApi.js";
import { useAuthStore } from "./authStore.js";
import { useToastStore } from "./toastStore.js";

function isOfflineError(e) {
  return (typeof navigator !== "undefined" && !navigator.onLine) || e instanceof TypeError;
}

export const useMessageStore = create((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  error: null,
  currentConvId: null, 

  loadMessages: async (token, convId) => {
    set({ loading: true, error: null });
    try {
      const messages = await getMessages(token, convId);
      set({ messages, loading: false, currentConvId: convId });
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  },

  send: async (token, convId, content, audioUrl = null, audioDuration = null) => {
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      role: "user",
      content,
      audio_url: audioUrl,
      audio_duration: audioDuration,
      created_at: new Date().toISOString(),
    };
    set((s) => {
      const startingFresh = String(s.currentConvId) !== String(convId);
      const base = startingFresh ? [] : s.messages;
      return {
        messages: [...base, optimisticMsg],
        sending: true,
        error: null,
        currentConvId: convId,
      };
    });
    try {
      const [userMsg, assistantMsg] = await sendMessage(token, convId, content, audioUrl, audioDuration);
      set((s) => ({
        messages: [...s.messages.filter((m) => m.id !== tempId), userMsg, assistantMsg],
        sending: false,
        currentConvId: convId,
      }));
    } catch (e) {
      if (isOfflineError(e)) {
        set((s) => ({
          messages: s.messages.map((m) => (m.id === tempId ? { ...m, pending: true } : m)),
          sending: false,
        }));
        useToastStore.getState().info("You're offline — this message will send once you're back online.");
      } else {
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== tempId),
          error: e.message,
          sending: false,
        }));
      }
    }
  },

  retryPending: async (token) => {
    const { messages, currentConvId } = get();
    if (!token || !currentConvId) return;
    const pending = messages.filter((m) => m.role === "user" && m.pending);
    for (const msg of pending) {
      set({ sending: true });
      try {
        const [userMsg, assistantMsg] = await sendMessage(
          token,
          currentConvId,
          msg.content,
          msg.audio_url,
          msg.audio_duration,
        );
        set((s) => ({
          messages: [...s.messages.filter((m) => m.id !== msg.id), userMsg, assistantMsg],
          sending: false,
        }));
      } catch (e) {
        set({ sending: false });
        if (isOfflineError(e)) {
          break;
        }
        set((s) => ({
          messages: s.messages.map((m) => (m.id === msg.id ? { ...m, pending: false } : m)),
          error: e.message,
        }));
        useToastStore.getState().error(`Failed to send queued message: ${e.message}`);
      }
    }
  },

  addMessages: (newMessages) => {
    set((s) => ({
      messages: [...s.messages, ...newMessages],
    }));
  },

  replaceOptimisticMessages: (realMessages) => {
    set((s) => ({
      messages: [...s.messages.filter((m) => !String(m.id).startsWith("temp-")), ...realMessages],
      sending: false,
    }));
  },

  setSending: (state) => {
    set({ sending: state });
  },

  clear: () => set({ messages: [], loading: false, sending: false, error: null, currentConvId: null }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    const token = useAuthStore.getState().accessToken;
    if (token) useMessageStore.getState().retryPending(token);
  });
}
