import type { UiTheme } from "@/features/app-settings/appSettingsTypes";

export function applyDocumentTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
}
