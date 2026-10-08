import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_UI_THEME, type UiTheme } from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings/AppSettingsContext";
import { colorsForTheme, typographyForColors, type ThemeColors } from "./tokens";

interface ThemeContextValue {
  theme: UiTheme;
  colors: ThemeColors;
  typography: ReturnType<typeof typographyForColors>;
  statusBarStyle: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function themeContextValue(theme: UiTheme): ThemeContextValue {
  const colors = colorsForTheme(theme);
  return {
    theme,
    colors,
    typography: typographyForColors(colors),
    statusBarStyle: theme === "light" ? "dark" : "light",
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppSettingsContext();
  return <ThemeScope theme={settings.ui.theme}>{children}</ThemeScope>;
}

/** Pins a subtree to one theme (e.g. the launch cover before saved settings apply). */
export function ThemeScope({ theme, children }: { theme: UiTheme; children: ReactNode }) {
  const value = useMemo(() => themeContextValue(theme), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const FALLBACK = themeContextValue(DEFAULT_UI_THEME);

/** Prefer ThemeProvider; falls back to dark tokens (e.g. early toast outside the tree). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
