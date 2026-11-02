import { describe, expect, it } from "vitest";
import {
  vaultStatusBadgeColors,
  vaultStatusIconColors,
  vaultStatusRowSurface,
} from "../vault-status";

const colors = {
  vaultStatusOpen: "#00ff00",
  vaultStatusRecovery: "#ffaa00",
  vaultStatusClosed: "#cccccc",
  vaultOpenIconBg: "#003300",
  vaultRecoveryIconBg: "#332200",
  surfaceContainer: "#111111",
  surfaceContainerHighest: "#222222",
  onSurfaceVariant: "#bbbbbb",
  vaultOpenBadgeBg: "#113311",
  vaultRecoveryBadgeBg: "#332211",
} as const;

describe("vault status theme mapping", () => {
  it("returns icon and badge colors per status", () => {
    expect(vaultStatusIconColors("open", colors as never)).toEqual({
      background: colors.vaultOpenIconBg,
      foreground: colors.vaultStatusOpen,
    });
    expect(vaultStatusBadgeColors("recovery", colors as never)).toEqual({
      background: colors.vaultRecoveryBadgeBg,
      foreground: colors.vaultStatusRecovery,
    });
  });

  it("marks the row edge like the desktop row", () => {
    expect(vaultStatusRowSurface("open", colors as never).borderLeftColor).toBe(
      colors.vaultStatusOpen,
    );
    expect(vaultStatusRowSurface("recovery", colors as never).borderLeftColor).toBe(
      colors.vaultStatusRecovery,
    );
    expect(vaultStatusRowSurface("closed", colors as never)).toMatchObject({
      borderLeftColor: "transparent",
    });
    expect(vaultStatusRowSurface("closed", colors as never).opacity).toBeUndefined();
  });

  it("dims a row whose work is in flight and edges it in the closed color", () => {
    for (const status of ["closing", "backing_up", "exporting", "opening"] as const) {
      expect(vaultStatusRowSurface(status, colors as never)).toEqual({
        backgroundColor: colors.surfaceContainer,
        borderLeftWidth: 2,
        borderLeftColor: "#cccccc99",
        opacity: 0.95,
      });
    }
  });
});
