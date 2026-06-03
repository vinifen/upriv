/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        "surface-container": "var(--surface-container)",
        "surface-container-high": "var(--surface-container-high)",
        "on-surface": "var(--on-surface)",
        "on-surface-variant": "var(--on-surface-variant)",
        "outline-variant": "var(--outline-variant)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        "error-container": "var(--error-container)",
        "on-error-container": "var(--on-error-container)",
        vault: {
          open: "var(--vault-status-open)",
          closed: "var(--vault-status-closed)",
          sealed: "var(--vault-status-sealed)",
          recovery: "var(--vault-status-recovery)",
        },
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      maxWidth: {
        content: "1200px",
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "32px",
      },
    },
  },
  plugins: [],
};
