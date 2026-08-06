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
    applyTheme(next, { animate: true });
  },

  init: () => {
    applyTheme(get().theme);
  },
}));

let _transitionTimer = null;

function applyTheme(theme, { animate = false } = {}) {
  const el = document.documentElement;

  if (animate) {
    el.classList.add("theme-transition");
    clearTimeout(_transitionTimer);
    _transitionTimer = setTimeout(() => {
      el.classList.remove("theme-transition");
    }, 320); 
  }

  el.classList.toggle("light", theme === "light");
  el.classList.toggle("dark", theme === "dark");
  el.setAttribute("data-theme", theme);
  el.style.colorScheme = theme;
}
