
import { create } from "zustand";
import * as authApi from "../services/authApi.js";

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  isBootstrapping: true, 
  error: null,
  registrationMessage: null,

  bootstrap: async () => {
    set({ isBootstrapping: true });
    try {
      const { accessToken, user } = await authApi.refreshToken();
      set({ accessToken, user, isBootstrapping: false });
      return true;
    } catch {
      set({ user: null, accessToken: null, isBootstrapping: false });
      return false;
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { user, accessToken } = await authApi.login(email, password);
      set({ user, accessToken, isLoading: false });
      return true;
    } catch (e) {
      set({ error: e.message, isLoading: false });
      return false;
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null, registrationMessage: null });
    try {
      const { message } = await authApi.register(email, password, name);
      set({ isLoading: false, registrationMessage: message });
      return true;
    } catch (e) {
      set({ error: e.message, isLoading: false });
      return false;
    }
  },

  refresh: async () => {
    try {
      const { accessToken, user } = await authApi.refreshToken();
      set({ accessToken, user });
      return true;
    } catch {
      set({ user: null, accessToken: null });
      return false;
    }
  },

  fetchMe: async () => {
    const { accessToken } = get();
    if (!accessToken) return false;
    try {
      const user = await authApi.getMe(accessToken);
      set({ user });
      return true;
    } catch {
      return false;
    }
  },

  setSession: ({ user, accessToken }) => set({ user, accessToken, isBootstrapping: false }),

  logout: async () => {
    try { await authApi.logout(); } catch {}
    set({ user: null, accessToken: null, error: null, registrationMessage: null });
  },

  clearError: () => set({ error: null }),
  clearRegistrationMessage: () => set({ registrationMessage: null }),
}));
