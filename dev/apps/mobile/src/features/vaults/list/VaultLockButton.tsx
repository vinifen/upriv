import { Pressable, Text, View } from "react-native";
import {
  isVaultPipelineDisplayBusy,
  isVaultOpenCredentialResumeStatus,
  type VaultDisplayStatus,
  vaultStatusI18nKey,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { mixHex, radii } from "@/theme/tokens";

const LOCK_WIDTH = 144;
const LOCK_HEIGHT = 44;
const LOCK_ICON_SIZE = 44;

interface VaultLockButtonProps {
  status: VaultDisplayStatus;
  layout?: "inline" | "block";
  /** Compact / small screens — lock / unlock glyph instead of the 9rem label. */
  appearance?: "label" | "icon";
  /** Waiting open can reopen the password dialog. A queued close cannot. */
  resumeUnlock?: boolean;
  onLock?: () => void;
  onUnlock?: () => void;
}

/** Desktop `VaultLockButton` — label on wide rows, icon on compact chrome. */
export function VaultLockButton({
  status,
  layout = "inline",
  appearance = "label",
  resumeUnlock,
  onLock,
  onUnlock,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isOpen = status === "open";
  const pipelineBusy = isVaultPipelineDisplayBusy(status);
  const resumeOpenCredential = resumeUnlock ?? isVaultOpenCredentialResumeStatus(status);
  const iconOnly = appearance === "icon" && layout !== "block";
  const label = pipelineBusy
    ? t(vaultStatusI18nKey[status] as I18nKey)
    : isOpen
      ? t("action.lock")
      : t("action.unlock");
  // Desktop: open = primary@30% on surfaceContainerHighest; closed/busy = highest only.
  const unlockSurface = colors.surfaceContainerHighest;
  const lockSurface = mixHex(colors.surfaceContainerHighest, colors.primary, 0.3);
  const backgroundColor = pipelineBusy ? unlockSurface : isOpen ? lockSurface : unlockSurface;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        busy: pipelineBusy,
        disabled: pipelineBusy && !resumeOpenCredential,
      }}
      disabled={pipelineBusy && !resumeOpenCredential}
      onPress={() => {
        if (pipelineBusy && !resumeOpenCredential) return;
        if (isOpen) onLock?.();
        else onUnlock?.();
      }}
      style={({ pressed }) => ({
        height: layout === "block" ? 40 : LOCK_HEIGHT,
        width: layout === "block" ? "100%" : iconOnly ? LOCK_ICON_SIZE : LOCK_WIDTH,
        borderRadius: radii.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor,
        opacity: pipelineBusy ? 0.7 : pressed ? 0.88 : 1,
      })}
    >
      {iconOnly ? (
        <Icon name={isOpen ? "lock" : "lock-open"} size={20} color={colors.onSurface} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}>
          <Icon name={isOpen ? "lock" : "lock-open"} size={18} color={colors.onSurface} />
          <Text
            numberOfLines={1}
            style={{
              color: colors.onSurface,
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: "500",
              flexShrink: 1,
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
