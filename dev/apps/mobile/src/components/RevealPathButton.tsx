import { Pressable, StyleSheet } from "react-native";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { revealableLocation } from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { FloatingToast, IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { revealInOsFileManager } from "@/lib/revealInFileManager";

/** Opens an absolute path or `content://` tree in the system Files app. */
export function RevealPathButton({
  path,
  inset = false,
}: {
  path: string | null | undefined;
  /** Fills the path field’s height so the hit target is the whole right edge. */
  inset?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { toast, show, dismiss } = useToast();
  const location = revealableLocation(path);
  if (!location) return null;

  const open = () => {
    void revealInOsFileManager(location).catch((error: unknown) => {
      show(t(mobileErrorI18nKey(error, "modal.file_manager.toast.open_system_failed")));
    });
  };
  const label = t("modal.file_manager.context.open_system");

  return (
    <>
      {inset ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          android_ripple={{ color: colors.surfaceContainerHigh, borderless: false }}
          onPress={open}
          style={({ pressed }) => [
            styles.inset,
            pressed ? { backgroundColor: colors.surfaceContainerHigh } : null,
          ]}
        >
          <Icon name="file-manager" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      ) : (
        <IconButton label={label} icon="file-manager" size={18} onPress={open} />
      )}
      <FloatingToast toast={toast} onDismiss={dismiss} />
    </>
  );
}

const styles = StyleSheet.create({
  inset: {
    width: 44,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
