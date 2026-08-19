import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { UiTheme } from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings/AppSettingsContext";
import { colorsForTheme, typographyForColors, type ThemeColors } from "./tokens";

interface ThemeContextValue {
  theme: UiTheme;
  colors: ThemeColors;
  typography: ReturnType<typeof typographyForColors>;
  statusBarStyle: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppSettingsContext();
  const theme = settings.ui.theme;
  const value = useMemo<ThemeContextValue>(() => {
    const colors = colorsForTheme(theme);
    return {
      theme,
      colors,
      typography: typographyForColors(colors),
      statusBarStyle: theme === "light" ? "dark" : "light",
    };
  }, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const FALLBACK: ThemeContextValue = (() => {
  const colors = colorsForTheme("dark");
  return {
    theme: "dark",
    colors,
    typography: typographyForColors(colors),
    statusBarStyle: "light",
  };
})();

/** Prefer ThemeProvider; falls back to dark tokens (e.g. early toast outside the tree). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
