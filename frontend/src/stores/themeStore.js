import { create } from "zustand";

function getInitialTheme() {
  try {
    const stored = localStorage.getItem("coach-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
}

export const useThemeStore = create((set, get) => ({
  theme: getInitialTheme(),

  toggle: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("coach-theme", next);
    } catch {}
    set({ theme: next });
    applyTheme(next);
  },

  init: () => {
    const t = get().theme;
    applyTheme(t);
  },
}));

function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
}