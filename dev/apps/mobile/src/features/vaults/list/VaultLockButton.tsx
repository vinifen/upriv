import { Animated, Pressable, Text, View } from "react-native";
import {
  isVaultOpenCredentialResumeStatus,
  type VaultDisplayStatus,
  type VaultRowButtonRole,
  vaultStatusI18nKey,
} from "@upriv/shared";
import { Icon, type IconName } from "@/components/icons";
import { usePulseOpacity } from "@/hooks/usePulseOpacity";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { mixHex, radii } from "@/theme/tokens";

const LOCK_WIDTH = 144;
const LOCK_HEIGHT = 44;
const LOCK_ICON_SIZE = 44;

interface VaultLockButtonProps {
  status: VaultDisplayStatus;
  role: VaultRowButtonRole;
  /** The first tap armed the button; the next one runs it. */
  armed: boolean;
  /** Runs an action through the row's arming. */
  press: (action: () => void) => void;
  layout?: "inline" | "block";
  /** Compact / small screens — glyph instead of the 9rem label. */
  appearance?: "label" | "icon";
  /** Waiting open can reopen the password dialog. A queued close cannot. */
  resumeUnlock?: boolean;
  onLock?: () => void;
  onUnlock?: () => void;
  onStop?: () => void;
}

function roleCopy(
  role: VaultRowButtonRole,
  armed: boolean,
  status: VaultDisplayStatus,
): { icon: IconName; label: I18nKey; hint: I18nKey | null } {
  switch (role) {
    case "stop":
      return armed
        ? { icon: "close", label: "action.confirm_stop", hint: "action.press_again_to_stop" }
        : { icon: "close", label: "action.stop", hint: null };
    case "stop_final":
      return { icon: "close", label: "action.stop", hint: "action.stop_final" };
    case "stopping":
      return { icon: "close", label: "vault.status.stopping", hint: null };
    case "lock":
      return armed
        ? { icon: "lock", label: "action.confirm_lock", hint: "action.press_again_to_lock" }
        : { icon: "lock", label: "action.lock", hint: null };
    case "unlock":
      return { icon: "lock-open", label: "action.unlock", hint: null };
    case "busy":
      return { icon: "lock-open", label: vaultStatusI18nKey[status] as I18nKey, hint: null };
  }
}

/**
 * The row's open/close button. While the row's work can stop it is Stop, in
 * the same place. A tap goes through the row's arming, so it may wait for a
 * second tap (System settings); armed, it turns red and pulses.
 */
export function VaultLockButton({
  status,
  role,
  armed,
  press,
  layout = "inline",
  appearance = "label",
  resumeUnlock,
  onLock,
  onUnlock,
  onStop,
}: VaultLockButtonProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const pulse = usePulseOpacity(armed);
  const iconOnly = appearance === "icon" && layout !== "block";
  const copy = roleCopy(role, armed, status);
  const resumeOpenCredential =
    role === "busy" && (resumeUnlock ?? isVaultOpenCredentialResumeStatus(status));
  const inert =
    role === "stop_final" || role === "stopping" || (role === "busy" && !resumeOpenCredential);
  // Desktop: open = primary@30% on surfaceContainerHighest; armed = error container.
  const backgroundColor = armed
    ? colors.errorContainer
    : role === "lock"
      ? mixHex(colors.surfaceContainerHighest, colors.primary, 0.3)
      : colors.surfaceContainerHighest;
  const foreground = armed ? colors.onErrorContainer : colors.onSurface;
  const label = t(copy.label);

  const run = () => {
    if (role === "stop") press(() => onStop?.());
    else if (role === "lock") press(() => onLock?.());
    else if (role === "unlock") press(() => onUnlock?.());
    else if (resumeOpenCredential) onUnlock?.();
  };

  return (
    // The pulse stays bound: unbinding a native animation mid-fade leaves its opacity on the view.
    <Animated.View style={{ opacity: pulse, width: layout === "block" ? "100%" : undefined }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={copy.hint ? t(copy.hint) : undefined}
        accessibilityState={{ busy: role === "busy" || role === "stopping", disabled: inert }}
        disabled={inert}
        onPress={run}
        style={({ pressed }) => ({
          height: layout === "block" ? 40 : LOCK_HEIGHT,
          width: layout === "block" ? "100%" : iconOnly ? LOCK_ICON_SIZE : LOCK_WIDTH,
          borderRadius: radii.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor,
          opacity: inert || role === "busy" ? 0.7 : pressed ? 0.88 : 1,
        })}
      >
        {iconOnly ? (
          <Icon name={copy.icon} size={20} color={foreground} />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}>
            <Icon name={copy.icon} size={18} color={foreground} />
            <Text
              numberOfLines={1}
              style={{
                color: foreground,
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
    </Animated.View>
  );
}
