/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        "surface-container": "var(--surface-container)",
        "surface-container-high": "var(--surface-container-high)",
        "surface-row-hover": "var(--surface-row-hover)",
        "on-surface": "var(--on-surface)",
        "on-surface-variant": "var(--on-surface-variant)",
        "outline-variant": "var(--outline-variant)",
        primary: "var(--primary)",
        "on-primary": "var(--on-primary)",
        "surface-container-highest": "var(--surface-container-highest)",
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
        "vault-list": "900px",
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "32px",
      },
    },
  },
  plugins: [],
};
