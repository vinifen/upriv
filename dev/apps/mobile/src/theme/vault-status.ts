import type { VaultDisplayStatus } from "@upriv/shared";
import type { ThemeColors } from "./tokens";

export function vaultStatusDotColor(status: VaultDisplayStatus, colors: ThemeColors): string {
  if (status === "open") return colors.vaultStatusOpen;
  if (status === "recovery") return colors.vaultStatusRecovery;
  return colors.vaultStatusClosed;
}

export function vaultStatusIconColors(
  status: VaultDisplayStatus,
  colors: ThemeColors,
): { background: string; foreground: string } {
  if (status === "open") {
    return { background: colors.vaultOpenIconBg, foreground: colors.vaultStatusOpen };
  }
  if (status === "recovery") {
    return {
      background: colors.vaultRecoveryIconBg,
      foreground: colors.vaultStatusRecovery,
    };
  }
  return { background: colors.surfaceContainerHighest, foreground: colors.onSurfaceVariant };
}

export function vaultStatusBadgeColors(
  status: VaultDisplayStatus,
  colors: ThemeColors,
): { background: string; foreground: string } {
  if (status === "open") {
    return { background: colors.vaultOpenBadgeBg, foreground: colors.vaultStatusOpen };
  }
  if (status === "recovery") {
    return {
      background: colors.vaultRecoveryBadgeBg,
      foreground: colors.vaultStatusRecovery,
    };
  }
  return { background: colors.surfaceContainerHighest, foreground: colors.onSurfaceVariant };
}
