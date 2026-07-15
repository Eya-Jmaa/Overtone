// frontend/src/stores/authStore.js
// REPLACE ENTIRELY

import { create } from "zustand";
import * as authApi from "../services/authApi.js";

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  isBootstrapping: true, // true until initial session check completes
  error: null,
  registrationMessage: null,

  // Called once on app mount — checks if the user has a valid refresh token cookie
  // and restores their session without forcing a re-login.
  bootstrap: async () => {
    set({ isBootstrapping: true });
    try {
      // /auth/refresh now returns { accessToken, user }
      const { accessToken, user } = await authApi.refreshToken();
      set({ accessToken, user, isBootstrapping: false });
      return true;
    } catch {
      // No valid refresh token — user needs to log in
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

  // Manual refresh — also restores user data now
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

  // Fetch the current user profile using the access token
  // (used by OAuthSuccess after getting the token from the URL hash)
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