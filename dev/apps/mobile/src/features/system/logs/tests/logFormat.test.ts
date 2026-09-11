import { describe, expect, it } from "vitest";
import { logLevelColor } from "../logFormat";

const colors = {
  onErrorContainer: "#ff0000",
  vaultStatusRecovery: "#ffaa00",
  accent: "#00aaff",
  onSurfaceVariant: "#999999",
  onSurface: "#ffffff",
} as const;

describe("logLevelColor", () => {
  it("maps known levels to theme colors", () => {
    expect(logLevelColor("ERROR", colors as never)).toBe(colors.onErrorContainer);
    expect(logLevelColor("WARN", colors as never)).toBe(colors.vaultStatusRecovery);
    expect(logLevelColor("INFO", colors as never)).toBe(colors.accent);
    expect(logLevelColor("DEBUG", colors as never)).toBe(colors.onSurfaceVariant);
  });

  it("falls back to default for unknown level", () => {
    expect(logLevelColor("UNKNOWN", colors as never)).toBe(colors.onSurface);
  });
});
