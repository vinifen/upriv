import { Pressable, StyleSheet } from "react-native";
import { Icon } from "@/components/icons";
import { useTheme } from "@/theme";
import { revealableLocation } from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { FloatingToast, IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { revealInOsFileManager } from "@/lib/revealInFileManager";

/**
 * Opening a folder in the system Files app, for a button or a menu item:
 * `locate` gives the absolute path or `content://` tree a path opens at
 * (`null` when it opens nowhere), `open` opens it, and a failure shows in
 * `toast`, which the caller renders once.
 */
export function useRevealFolder() {
  const { t } = useTranslation();
  const { toast, show, dismiss } = useToast();
  const locate = (path: string | null | undefined): string | null =>
    revealableLocation(path) ?? null;
  const open = (location: string) => {
    void revealInOsFileManager(location).catch((error: unknown) => {
      show(t(mobileErrorI18nKey(error, "modal.file_manager.toast.open_system_failed")));
    });
  };
  return { locate, open, toast: <FloatingToast toast={toast} onDismiss={dismiss} /> };
}

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
  const reveal = useRevealFolder();
  const location = reveal.locate(path);
  if (!location) return null;

  const open = () => reveal.open(location);
  const label = t("action.open_folder");

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
      {reveal.toast}
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
