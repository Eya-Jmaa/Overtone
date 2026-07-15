export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        bone: "var(--bone)",
        "bone-dim": "var(--bone-dim)",
        "bone-faint": "var(--bone-faint)",
        gold: "var(--gold)",
        "gold-soft": "var(--gold-soft)",
        whisper: "var(--whisper)",
        "whisper-2": "var(--whisper-2)",
      },
      fontFamily: {
        fraunces: ["Fraunces", "serif"],
        inter: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
}
