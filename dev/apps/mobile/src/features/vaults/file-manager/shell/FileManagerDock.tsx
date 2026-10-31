import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  delayMs,
  DOCK_COLLAPSE_MS,
  DOCK_EXPAND_MS,
  vaultDisplayLetters,
  type FileManagerShellEntry,
} from "@upriv/shared";
import { useOptimisticValue } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { dockChipBoxShadow, radii, spacing, touchMin } from "@/theme/tokens";

/** Same cap as desktop dock `14.5rem` (~232px). */
const DOCK_MAX_WIDTH = 232;
/** Room for per-chip `boxShadow` (desktop grid `px-1.5`). */
const SHADOW_PAD = spacing.sm;
/** How far the chips rise as they appear. */
const REVEAL_RISE = 8;

interface FileManagerDockProps {
  entries: readonly FileManagerShellEntry[];
  focusedVaultId: string | null;
  maximizedVaultId: string | null;
  onMinimize: (vaultId: string) => void;
  onRestore: (vaultId: string) => void;
  onDismiss: (vaultId: string) => void;
}

function DockChevron({ expanded, color }: { expanded: boolean; color: string }) {
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: expanded ? DOCK_EXPAND_MS : DOCK_COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="chevron-down" size={14} color={color} />
    </Animated.View>
  );
}

export function FileManagerDock({
  entries,
  focusedVaultId,
  maximizedVaultId,
  onMinimize,
  onRestore,
  onDismiss,
}: FileManagerDockProps) {
  const { t } = useTranslation();
  const { colors, typography, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { settings, patchSettings } = useAppSettingsContext();
  // The dock moves on the tap. The setting is written once it has moved, so
  // the save and the re-render it brings do not share frames with the motion.
  const saveExpanded = useCallback(
    (next: boolean) =>
      delayMs(next ? DOCK_EXPAND_MS : DOCK_COLLAPSE_MS).then(() =>
        patchSettings({ ui: { file_manager_dock_expanded: next } }),
      ),
    [patchSettings],
  );
  const [expanded, setExpanded] = useOptimisticValue(
    settings.ui.file_manager_dock_expanded ?? false,
    saveExpanded,
  );
  const dockMaxWidth = Math.min(DOCK_MAX_WIDTH, windowWidth - spacing.lg * 2);
  const chipMaxWidth = Math.max(0, dockMaxWidth - SHADOW_PAD * 2);
  const namesKey = entries.map((entry) => `${entry.vaultId}:${entry.displayName}`).join("|");
  const [columnWidth, setColumnWidth] = useState<number | undefined>(undefined);
  const chipShadow = useMemo(() => ({ boxShadow: dockChipBoxShadow(theme) }), [theme]);
  // The chips fade and rise on the native driver. The dock floats over the
  // screen, so nothing else moves and no frame waits on a layout pass.
  const reveal = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const [listShown, setListShown] = useState(expanded);
  if (expanded && !listShown) setListShown(true);

  useEffect(() => {
    setColumnWidth(undefined);
  }, [namesKey, chipMaxWidth]);

  useEffect(() => {
    const animation = Animated.timing(reveal, {
      toValue: expanded ? 1 : 0,
      duration: expanded ? DOCK_EXPAND_MS : DOCK_COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !expanded) setListShown(false);
    });
    return () => animation.stop();
  }, [expanded, reveal]);

  if (entries.length === 0) return null;

  const highlightVaultId =
    focusedVaultId ?? maximizedVaultId ?? (entries.length === 1 ? entries[0].vaultId : null);

  const toggleExpanded = () => setExpanded(!expanded);

  const handleEntryClick = (vaultId: string) => {
    if (vaultId === maximizedVaultId) {
      onMinimize(vaultId);
      return;
    }
    onRestore(vaultId);
  };

  return (
    <View
      pointerEvents="box-none"
      collapsable={false}
      style={[
        styles.host,
        {
          bottom: Math.max(insets.bottom, spacing.md) + spacing.sm,
          maxWidth: dockMaxWidth,
        },
      ]}
      accessibilityLabel={t("modal.file_manager.dock.label")}
    >
      <View style={styles.stack}>
        {listShown ? (
          <Animated.View
            pointerEvents={expanded ? "auto" : "none"}
            accessibilityElementsHidden={!expanded}
            importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
            style={[
              styles.list,
              {
                opacity: reveal,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [REVEAL_RISE, 0],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(event) => {
              const next = Math.min(Math.round(event.nativeEvent.layout.width), chipMaxWidth);
              if (next <= 0) return;
              setColumnWidth((prev) => (prev === next ? prev : next));
            }}
          >
            {entries.map((entry) => {
              const active = entry.vaultId === highlightVaultId;
              const isMaximized = entry.vaultId === maximizedVaultId;
              const importing = entry.importInFlight;
              const letters = vaultDisplayLetters(entry.displayName);
              return (
                <View
                  key={entry.vaultId}
                  collapsable={false}
                  style={[
                    styles.chipShell,
                    chipShadow,
                    {
                      maxWidth: chipMaxWidth,
                      ...(columnWidth != null ? { width: columnWidth } : null),
                      backgroundColor: colors.surfaceContainerHigh,
                      borderColor: active ? colors.accent : "transparent",
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => handleEntryClick(entry.vaultId)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      importing
                        ? t("modal.file_manager.dock.importing", { name: entry.displayName })
                        : isMaximized
                          ? t("modal.file_manager.dock.minimize", { name: entry.displayName })
                          : t("modal.file_manager.dock.restore", { name: entry.displayName })
                    }
                    style={({ pressed }) => [
                      styles.chip,
                      pressed ? { backgroundColor: colors.surfaceContainer } : null,
                    ]}
                  >
                    <View
                      style={[styles.chipAvatar, { backgroundColor: colors.surfaceContainer }]}
                      accessibilityElementsHidden
                    >
                      {importing ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Text
                          style={[
                            styles.chipLetters,
                            {
                              color: colors.accent,
                              fontSize: letters.length > 1 ? 11 : 12,
                              letterSpacing: letters.length > 1 ? -0.6 : 0,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {letters}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[
                        typography.body,
                        styles.chipName,
                        {
                          color: colors.onSurface,
                          flexGrow: columnWidth != null ? 1 : 0,
                        },
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {entry.displayName}
                    </Text>
                    <View style={styles.chipDismiss} onStartShouldSetResponder={() => true}>
                      <IconButton
                        label={t("modal.file_manager.action.dismiss")}
                        icon="close"
                        size={16}
                        onPress={() => onDismiss(entry.vaultId)}
                      />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Animated.View>
        ) : null}

        <View
          collapsable={false}
          style={[
            styles.toggleShell,
            chipShadow,
            {
              backgroundColor: colors.surfaceContainerHigh,
              alignSelf: expanded ? "stretch" : "flex-end",
              maxWidth: chipMaxWidth,
            },
          ]}
        >
          <Pressable
            onPress={toggleExpanded}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={
              expanded ? t("modal.file_manager.dock.collapse") : t("modal.file_manager.dock.expand")
            }
            style={({ pressed }) => [
              styles.toggle,
              pressed ? { backgroundColor: colors.surfaceContainer } : null,
            ]}
          >
            <View style={[styles.toggleIcon, { backgroundColor: colors.surfaceContainer }]}>
              <Icon name="folder" size={16} color={colors.accent} />
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                  {entries.length}
                </Text>
              </View>
            </View>
            <DockChevron expanded={expanded} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    right: spacing.lg,
    zIndex: 110,
    // Stack above the FM modal; transparent so this box does not paint a tower shadow.
    elevation: 110,
    shadowColor: "transparent",
    shadowOpacity: 0,
    alignItems: "flex-end",
  },
  stack: {
    maxWidth: "100%",
    paddingHorizontal: SHADOW_PAD,
    alignItems: "flex-end",
  },
  list: {
    gap: 10,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    alignItems: "flex-end",
  },
  chipShell: {
    alignSelf: "flex-end",
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  chip: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: touchMin - 4,
    overflow: "hidden",
  },
  chipAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipLetters: {
    fontWeight: "600",
    includeFontPadding: false,
    textAlign: "center",
  },
  chipName: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "600",
  },
  chipDismiss: {
    flexShrink: 0,
  },
  toggleShell: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    overflow: "hidden",
  },
  toggleIcon: {
    position: "relative",
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    minWidth: 16,
    height: 16,
    borderRadius: radii.full,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    includeFontPadding: false,
  },
});
