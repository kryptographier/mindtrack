/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--color-paper)",
        "paper-raised": "var(--color-paper-raised)",
        ink: "var(--color-ink)",
        "ink-soft": "var(--color-ink-soft)",
        line: "var(--color-line)",
        accent: "var(--color-accent)",
        "accent-soft": "var(--color-accent-soft)",
        danger: "var(--color-danger)",
        mood: {
          great: "var(--color-mood-great)",
          good: "var(--color-mood-good)",
          okay: "var(--color-mood-okay)",
          low: "var(--color-mood-low)",
          difficult: "var(--color-mood-difficult)",
        },
        term: {
          bg: "var(--term-bg)",
          surface: "var(--term-surface)",
          text: "var(--term-text)",
          dim: "var(--term-text-dim)",
          accent: "var(--term-accent)",
          line: "var(--term-line)",
        },
      },
      fontFamily: {
        ui: ["IBM Plex Sans", "system-ui", "sans-serif"],
        journal: ["Literata", "Georgia", "serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
      },
    },
  },
  plugins: [],
};
