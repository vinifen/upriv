/**
 * Theme colors are CSS variables holding hex values, so Tailwind cannot add an
 * alpha channel itself. Opacity modifiers (`bg-accent/15`) mix with transparent,
 * matching mobile `colorAlpha`.
 */
function themeColor(variable) {
  return ({ opacityValue }) => {
    if (opacityValue === undefined || String(opacityValue).startsWith("var(")) {
      return `var(${variable})`;
    }
    return `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;
  };
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: themeColor("--background"),
        "surface-container": themeColor("--surface-container"),
        "surface-container-low": themeColor("--surface-container-low"),
        "surface-container-high": themeColor("--surface-container-high"),
        "surface-row-hover": themeColor("--surface-row-hover"),
        "on-surface": themeColor("--on-surface"),
        "on-surface-variant": themeColor("--on-surface-variant"),
        "outline-variant": themeColor("--outline-variant"),
        primary: themeColor("--primary"),
        "on-primary": themeColor("--on-primary"),
        "surface-container-highest": themeColor("--surface-container-highest"),
        accent: themeColor("--accent"),
        "accent-foreground": themeColor("--accent-foreground"),
        "error-container": themeColor("--error-container"),
        "on-error-container": themeColor("--on-error-container"),
        vault: {
          open: themeColor("--vault-status-open"),
          closed: themeColor("--vault-status-closed"),
          recovery: themeColor("--vault-status-recovery"),
        },
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      maxWidth: {
        /** From `@upriv/shared` `MAX_WIDTH_*` via `cssCustomProperties`. */
        content: "var(--max-width-content)",
        "vault-list": "var(--max-width-vault-list)",
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "32px",
      },
      borderRadius: {
        sm: "var(--radius-xs)",
        DEFAULT: "var(--radius-xs)",
        md: "var(--radius-sm)",
        lg: "var(--radius-sm)",
        xl: "var(--radius-md)",
        "2xl": "var(--radius-lg)",
        full: "var(--radius-full)",
      },
    },
  },
  plugins: [],
};
