import type { UiTheme } from "@upriv/shared";

export function applyDocumentTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
}
