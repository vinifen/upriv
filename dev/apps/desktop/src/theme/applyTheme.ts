import { DEFAULT_UI_THEME, cssCustomProperties, type UiTheme } from "@upriv/shared";

export function applyDocumentTheme(theme: UiTheme = DEFAULT_UI_THEME): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  const vars = cssCustomProperties(theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
