import { create } from "zustand";
import { getMessages, sendMessage } from "../services/messageApi.js";

export const useMessageStore = create((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  error: null,
  currentConvId: null, // tracks which conversation's messages are loaded

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
    // Optimistically show the user's own message immediately instead of
    // waiting for the LLM round-trip - the "thinking" indicator (driven by
    // `sending`) then covers only the assistant's reply latency.
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      role: "user",
      content,
      audio_url: audioUrl,
      audio_duration: audioDuration,
      created_at: new Date().toISOString(),
    };
    // Guard against cross-conversation bleed: this store is a singleton, so if
    // we're sending into a different conversation than the one currently
    // loaded, start from an empty list instead of appending onto the previous
    // conversation's messages.
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
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== tempId),
        error: e.message,
        sending: false,
      }));
    }
  },

  // Add messages from WebSocket (for live streaming path)
  addMessages: (newMessages) => {
    set((s) => ({
      messages: [...s.messages, ...newMessages],
    }));
  },

  // Replace optimistic temp messages with the real server messages.
  // Uses String(m.id) because real messages have numeric ids (no .startsWith).
  replaceOptimisticMessages: (realMessages) => {
    set((s) => ({
      messages: [...s.messages.filter((m) => !String(m.id).startsWith("temp-")), ...realMessages],
      sending: false,
    }));
  },

  // Set sending state (for optimistic audio uploads)
  setSending: (state) => {
    set({ sending: state });
  },

  clear: () => set({ messages: [], loading: false, sending: false, error: null, currentConvId: null }),
}));