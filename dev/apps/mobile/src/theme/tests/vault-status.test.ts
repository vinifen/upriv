import { describe, expect, it } from "vitest";
import {
  vaultStatusBadgeColors,
  vaultStatusDotColor,
  vaultStatusIconColors,
} from "../vault-status";

const colors = {
  vaultStatusOpen: "#00ff00",
  vaultStatusRecovery: "#ffaa00",
  vaultStatusClosed: "#cccccc",
  vaultOpenIconBg: "#003300",
  vaultRecoveryIconBg: "#332200",
  surfaceContainerHighest: "#222222",
  onSurfaceVariant: "#bbbbbb",
  vaultOpenBadgeBg: "#113311",
  vaultRecoveryBadgeBg: "#332211",
} as const;

describe("vault status theme mapping", () => {
  it("returns dot color per status", () => {
    expect(vaultStatusDotColor("open", colors as never)).toBe(colors.vaultStatusOpen);
    expect(vaultStatusDotColor("recovery", colors as never)).toBe(colors.vaultStatusRecovery);
    expect(vaultStatusDotColor("closed", colors as never)).toBe(colors.vaultStatusClosed);
  });

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
});
