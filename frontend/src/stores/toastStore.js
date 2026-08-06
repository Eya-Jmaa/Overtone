import { create } from "zustand";

export const useToastStore = create((set, get) => ({
  toasts: [],

  add: (message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    set((s) => ({
      toasts: [...s.toasts, { id, message, type, duration }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        get().remove(id);
      }, duration);
    }
    return id;
  },

  remove: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },

  error: (message, duration) => get().add(message, "error", duration),
  success: (message, duration) => get().add(message, "success", duration),
  info: (message, duration) => get().add(message, "info", duration),

  clear: () => set({ toasts: [] }),
}));
