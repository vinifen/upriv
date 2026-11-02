import type { ViewStyle } from "react-native";
import { isVaultPipelineDisplayBusy, type VaultDisplayStatus } from "@upriv/shared";
import { colorAlpha, type ThemeColors } from "./tokens";

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

/**
 * Row and block card surface — desktop `vaultStatusRowClass`. Open and
 * recovery mark the left edge in their color; work in flight dims the row and
 * marks the edge in the closed color.
 */
export function vaultStatusRowSurface(status: VaultDisplayStatus, colors: ThemeColors): ViewStyle {
  const surface = { backgroundColor: colors.surfaceContainer, borderLeftWidth: 2 };
  if (status === "open") return { ...surface, borderLeftColor: colors.vaultStatusOpen };
  if (status === "recovery") return { ...surface, borderLeftColor: colors.vaultStatusRecovery };
  if (isVaultPipelineDisplayBusy(status)) {
    return {
      ...surface,
      borderLeftColor: colorAlpha(colors.vaultStatusClosed, 0.6),
      opacity: 0.95,
    };
  }
  return { ...surface, borderLeftColor: "transparent" };
}
