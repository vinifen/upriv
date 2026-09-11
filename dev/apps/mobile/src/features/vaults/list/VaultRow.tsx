import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import {
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  vaultDisplayLetters,
  VAULT_ROW_DENSITY,
  type VaultDisplayStatus,
  type VaultListItem,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { radii, spacing, vaultRowShadow } from "@/theme/tokens";
import { useVaultRowChrome } from "@/hooks/useVaultRowChrome";
import { vaultStatusIconColors } from "@/theme/vault-status";
import { DropOverRing } from "./DropOverRing";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";
import { useAppSettingsContext } from "@/features/system/settings";

export interface VaultRowDropTargetProps {
  ref?: (node: View | null) => void;
  onLayout?: () => void;
  collapsable?: boolean;
}

interface VaultRowProps {
  vault: VaultListItem;
  variant?: "row" | "block";
  viewMode: VaultListViewMode;
  nested?: boolean;
  pipelineListStatus?: {
    openingVaultIds?: readonly string[];
    closingVaultIds?: readonly string[];
  };
  dragEnabled: boolean;
  dragHandleLabel?: string;
  groupBusy?: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  isDropBlocked?: boolean;
  isPipelineBusy: boolean;
  dropTargetProps?: VaultRowDropTargetProps;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragCancel: () => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenSettings: (vault: VaultListItem, area: VaultSettingsAreaId) => void;
  onUnlock: (vault: VaultListItem) => void;
  onLock: (vault: VaultListItem) => void;
  onExport: (vault: VaultListItem) => void;
  onOpenBackups: (vault: VaultListItem) => void;
  onOpenNote: (vault: VaultListItem) => void;
  onOpenVaultInfo: (vault: VaultListItem) => void;
}

export function VaultRow({
  vault,
  variant = "row",
  viewMode,
  nested = false,
  pipelineListStatus = {},
  dragEnabled,
  dragHandleLabel,
  groupBusy = false,
  isDragging,
  isDragOver,
  isDropBlocked = false,
  isPipelineBusy,
  dropTargetProps,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onOpenFileManager,
  onOpenFolder,
  onOpenSettings,
  onUnlock,
  onLock,
  onExport,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
}: VaultRowProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = resolveVaultDisplayStatus(vault) === "open";
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density = VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode];
  const { chrome, onLayout: onChromeLayout } = useVaultRowChrome();
  const comfortable = variant === "block" || chrome === "comfortable";
  const lastAccessedLabel = t("vault.last_accessed", { when: vault.lastAccessedWhen });
  const lastAccessedText = comfortable ? lastAccessedLabel : vault.lastAccessedWhen;
  const showGrip = dragEnabled && !groupBusy;
  const iconTone = vaultStatusIconColors(status, colors);
  const letters = vaultDisplayLetters(vault.displayName);
  const avatarSize = variant === "block" ? 36 : density.icon;
  const avatarLetters = variant === "block" ? 13 : density.iconLetters;
  const avatar = (
    <View
      style={[
        styles.avatarCircle,
        { width: avatarSize, height: avatarSize, backgroundColor: iconTone.background },
        variant === "block" ? { alignSelf: "flex-start", marginTop: 2 } : null,
      ]}
      accessibilityElementsHidden
    >
      <Text
        style={[
          styles.avatarLetters,
          {
            color: iconTone.foreground,
            fontSize: avatarLetters,
            letterSpacing: letters.length > 1 ? -0.6 : 0,
          },
        ]}
        numberOfLines={1}
      >
        {letters}
      </Text>
    </View>
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    onChromeLayout(event);
    dropTargetProps?.onLayout?.();
  };

  const actions = (
    <VaultRowActions
      vault={vault}
      pipelineListStatus={pipelineListStatus}
      disabled={isPipelineBusy}
      includeLockAction={false}
      layout={variant === "block" ? "column" : "row"}
      onOpenBackups={onOpenBackups}
      onOpenNote={onOpenNote}
      onOpenVaultInfo={onOpenVaultInfo}
      onOpenSettings={onOpenSettings}
      onExportVault={onExport}
      onOpenFileManager={onOpenFileManager}
      onOpenFolder={onOpenFolder}
      onLockVault={onLock}
      onUnlockVault={onUnlock}
    />
  );

  const identity = (
    <View style={[styles.identity, variant === "block" ? styles.blockIdentity : null]}>
      <View style={styles.titleRow}>
        <Text
          style={[styles.title, { color: colors.onSurface, fontSize: density.titleSize }]}
          numberOfLines={variant === "block" ? 2 : 1}
        >
          {vault.displayName}
        </Text>
        <VaultLastOpenedIndicator active={isLastOpened} />
        <VaultHiddenIndicator hidden={vault.hidden} />
      </View>
      {variant === "block" ? (
        <>
          <VaultStatusBadge status={status} />
          <Text style={typography.caption} numberOfLines={1} accessibilityLabel={lastAccessedLabel}>
            {lastAccessedText}
          </Text>
        </>
      ) : (
        <View style={styles.metaRow}>
          <VaultStatusBadge status={status} />
          <View style={styles.metaWhen} accessible accessibilityLabel={lastAccessedLabel}>
            {!comfortable ? <Icon name="clock" size={12} color={colors.onSurfaceVariant} /> : null}
            <Text style={[typography.caption, styles.meta]} numberOfLines={1}>
              {lastAccessedText}
            </Text>
          </View>
        </View>
      )}
    </View>
  );

  const openOrUnlock = () => {
    if (isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    else if (status === "closed" || status === "recovery") onUnlock(vault);
  };
  const rowActivates = isOpen || status === "closed" || status === "recovery";
  const dropRing = (
    <DropOverRing
      visible={isDragOver}
      blocked={isDropBlocked}
      accent={colors.accent}
      recovery={colors.vaultStatusRecovery}
    />
  );

  if (variant === "block") {
    return (
      <Pressable
        {...dropTargetProps}
        onLayout={handleLayout}
        onPress={rowActivates ? openOrUnlock : undefined}
        accessibilityRole={rowActivates ? "button" : undefined}
        accessibilityLabel={
          isOpen
            ? t("action.open_upriv")
            : status === "closed" || status === "recovery"
              ? t("action.unlock")
              : undefined
        }
        style={[
          styles.blockCard,
          rowSurface(
            status,
            colors.surfaceContainer,
            colors.vaultStatusOpen,
            colors.vaultStatusRecovery,
          ),
          isDragging ? { opacity: 0.45 } : null,
        ]}
      >
        {dropRing}
        <View style={styles.blockTop}>
          {showGrip ? (
            <VaultDragHandle
              disabled={!dragEnabled || groupBusy}
              label={dragHandleLabel}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            />
          ) : null}
          {avatar}
          {identity}
          {actions}
        </View>
        <VaultLockButton
          status={status}
          layout="block"
          onLock={() => onLock(vault)}
          onUnlock={() => onUnlock(vault)}
        />
      </Pressable>
    );
  }

  return (
    <Pressable
      {...dropTargetProps}
      onLayout={handleLayout}
      onPress={rowActivates ? openOrUnlock : undefined}
      accessibilityRole={rowActivates ? "button" : undefined}
      accessibilityLabel={
        isOpen
          ? t("action.open_upriv")
          : status === "closed" || status === "recovery"
            ? t("action.unlock")
            : undefined
      }
      style={[
        styles.row,
        nested ? styles.memberRow : null,
        {
          paddingVertical: density.paddingY,
          paddingRight: density.paddingX,
          paddingLeft: showGrip ? Math.max(density.paddingX - 8, spacing.sm) : density.paddingX,
        },
        rowSurface(
          status,
          colors.surfaceContainer,
          colors.vaultStatusOpen,
          colors.vaultStatusRecovery,
        ),
        isDragging ? { opacity: 0.45 } : null,
      ]}
    >
      {dropRing}
      {showGrip ? (
        <VaultDragHandle
          disabled={!dragEnabled || groupBusy}
          label={dragHandleLabel}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        />
      ) : null}
      {comfortable ? avatar : null}
      <View style={styles.rowPress}>{identity}</View>
      {actions}
      <VaultLockButton
        status={status}
        appearance="icon"
        onLock={() => onLock(vault)}
        onUnlock={() => onUnlock(vault)}
      />
    </Pressable>
  );
}

function rowSurface(
  status: VaultDisplayStatus,
  surface: string,
  open: string,
  recovery: string,
): ViewStyle {
  if (status === "open") {
    return { backgroundColor: surface, borderLeftWidth: 2, borderLeftColor: open };
  }
  if (status === "recovery") {
    return { backgroundColor: surface, borderLeftWidth: 2, borderLeftColor: recovery };
  }
  return { backgroundColor: surface, borderLeftWidth: 2, borderLeftColor: "transparent" };
}

const styles = StyleSheet.create({
  row: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    ...vaultRowShadow,
  },
  memberRow: { marginBottom: 0 },
  rowPress: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  identity: { flex: 1, minWidth: 0, gap: 4, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  title: { flexShrink: 1, minWidth: 0, fontWeight: "600", includeFontPadding: false },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  metaWhen: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { flex: 1, minWidth: 0 },
  avatarCircle: {
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarLetters: {
    fontWeight: "600",
    includeFontPadding: false,
    textAlign: "center",
  },
  blockCard: {
    position: "relative",
    minHeight: 160,
    padding: 14,
    borderRadius: radii.md,
    justifyContent: "space-between",
    gap: spacing.sm,
    ...vaultRowShadow,
  },
  blockTop: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 10 },
  blockIdentity: { justifyContent: "space-between", gap: 6, paddingVertical: 2 },
});
