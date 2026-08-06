import { create } from "zustand";
import * as convApi from "../services/convApi.js";

export const useConvStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  isLoading: false,
  error: null,

  loadConversations: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await convApi.listConversations(token);
      set({ conversations, isLoading: false });
    } catch (e) {
      set({ error: e.message, isLoading: false });
    }
  },

  createConversation: async ({ mode, title }, token) => {
    set({ error: null });
    try {
      const conv = await convApi.createConversation({ mode, title }, token);
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeId: conv.id,
      }));
      return conv;
    } catch (e) {
      set({ error: e.message });
      return null;
    }
  },

  deleteConversation: async (id, token) => {
    set({ error: null });
    try {
      await convApi.deleteConversation(id, token);
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
      }));
      return true;
    } catch (e) {
      set({ error: e.message });
      return false;
    }
  },

  setActive: (id) => set({ activeId: id }),

  refreshConversation: async (id, token) => {
    try {
      const conv = await convApi.getConversation(id, token);
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === conv.id ? conv : c)),
      }));
      return conv;
    } catch (_) {
      return null;
    }
  },

  pollConversationTitle: async (id, token, { attempts = 5, delayMs = 900 } = {}) => {
    for (let i = 0; i < attempts; i++) {
      const conv = await get().refreshConversation(id, token);
      if (conv?.title) return conv;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  },
}));
