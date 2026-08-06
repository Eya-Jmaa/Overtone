import { create } from "zustand";

export const useDraftStore = create((set, get) => ({
  draftMode: null,

  setDraftMode: (mode) => set({ draftMode: mode }),

  clearDraft: () => set({ draftMode: null }),
}));
