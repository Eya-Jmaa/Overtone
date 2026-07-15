import { create } from "zustand";

/**
 * Tracks the draft conversation state.
 * When user clicks "New Conversation" and selects a mode, we store
 * a draft mode here. The conversation only gets created in the DB
 * when the first message is sent.
 */
export const useDraftStore = create((set, get) => ({
  draftMode: null,

  setDraftMode: (mode) => set({ draftMode: mode }),

  clearDraft: () => set({ draftMode: null }),
}));