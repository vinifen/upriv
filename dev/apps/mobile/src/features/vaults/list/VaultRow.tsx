import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import {
  resolveVaultListStatus,
  isVaultListRowActivatable,
  isVaultListRowUnlockTarget,
  isVaultOpenResumeTarget,
  vaultPipelineRowBudget,
  vaultDisplayLetters,
  vaultLastAccessedLabel,
  vaultStatusI18nKey,
  VAULT_ROW_DENSITY,
  type VaultDisplayStatus,
  type VaultListItem,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { LoadingBudgetHint } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { radii, spacing, vaultRowBoxShadow } from "@/theme/tokens";
import { useVaultRowChrome } from "@/hooks/useVaultRowChrome";
import { vaultStatusIconColors } from "@/theme/vault-status";
import { DropOverRing } from "./DropOverRing";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";
import { VaultFileManagerIndicator } from "@/features/vaults/file-manager";
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
  pipelineListStatus?: import("@upriv/shared").VaultPipelineListStatus;
  dragEnabled: boolean;
  dragHandleLabel?: string;
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
  onOpenSettings,
  onUnlock,
  onLock,
  onExport,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
}: VaultRowProps) {
  const { t, locale } = useTranslation();
  const { colors, typography, theme } = useTheme();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = status === "open";
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density = VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode];
  const blockTitleSize = VAULT_ROW_DENSITY.blocks.titleSize;
  const { chrome, onLayout: onChromeLayout } = useVaultRowChrome();
  const comfortable = chrome === "comfortable";
  const lastAccessedWhen = vaultLastAccessedLabel(vault, locale);
  const lastAccessedLabel = t("vault.last_accessed", { when: lastAccessedWhen });
  const lastAccessedText =
    variant === "block" || comfortable ? lastAccessedLabel : lastAccessedWhen;
  const rowBudget = vaultPipelineRowBudget(status, pipelineListStatus, vault.id);
  const openingBudget = useLoadingBudget(rowBudget.active, rowBudget.budgetMs, {
    startedAt: rowBudget.startedAt,
  });
  const lastAccessedOrBudget = openingBudget.visible ? (
    <LoadingBudgetHint
      budgetMs={openingBudget.budgetMs}
      remainingMs={openingBudget.remainingMs}
      layout="inline"
    />
  ) : (
    <Text style={[typography.caption, styles.meta]} numberOfLines={1}>
      {lastAccessedText}
    </Text>
  );
  const showGrip = dragEnabled;
  const gripDisabled = isPipelineBusy;
  const iconTone = vaultStatusIconColors(status, colors);
  const letters = vaultDisplayLetters(vault.displayName);
  const avatarSize = variant === "block" ? 36 : density.icon;
  const avatarLetters = variant === "block" ? 13 : density.iconLetters;
  const avatar = (
    <View
      style={[
        styles.avatarCircle,
        { width: avatarSize, height: avatarSize, backgroundColor: iconTone.background },
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
      onLockVault={onLock}
      onUnlockVault={onUnlock}
    />
  );

  const identity = (
    <View style={styles.identity}>
      <View style={styles.titleRow}>
        <Text
          style={[styles.title, { color: colors.onSurface, fontSize: density.titleSize }]}
          numberOfLines={1}
        >
          {vault.displayName}
        </Text>
        <VaultLastOpenedIndicator active={isLastOpened} />
        <VaultFileManagerIndicator vaultId={vault.id} />
        <VaultHiddenIndicator hidden={vault.hidden} />
      </View>
      <View style={styles.metaRow}>
        <VaultStatusBadge status={status} />
        <View style={styles.metaWhen} accessible accessibilityLabel={lastAccessedLabel}>
          {!comfortable ? <Icon name="clock" size={12} color={colors.onSurfaceVariant} /> : null}
          {lastAccessedOrBudget}
        </View>
      </View>
    </View>
  );

  const blockIdentity = (
    <View style={styles.blockIdentity}>
      <View style={styles.blockTitleRow}>
        {avatar}
        <View style={styles.blockTitleText}>
          <Text
            style={[styles.title, { color: colors.onSurface, fontSize: blockTitleSize }]}
            numberOfLines={2}
          >
            {vault.displayName}
          </Text>
          <VaultLastOpenedIndicator active={isLastOpened} size={13} />
          <VaultFileManagerIndicator vaultId={vault.id} size={13} />
          <VaultHiddenIndicator hidden={vault.hidden} size={13} />
        </View>
      </View>
      <View style={styles.blockMetaRow}>
        <VaultStatusBadge status={status} />
        <View style={styles.metaWhen} accessible accessibilityLabel={lastAccessedLabel}>
          {lastAccessedOrBudget}
        </View>
      </View>
    </View>
  );

  const resumeOpen = isVaultOpenResumeTarget(status, vault.id, pipelineListStatus);
  const canUnlockFromRow =
    isVaultListRowUnlockTarget(status) && (status !== "queued" || resumeOpen);
  const openOrUnlock = () => {
    if (isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    else if (canUnlockFromRow) onUnlock(vault);
  };
  const rowActivates = isVaultListRowActivatable(status) && (status !== "queued" || resumeOpen);
  const activateLabel = isOpen
    ? t("action.open_upriv")
    : canUnlockFromRow
      ? status === "closed" || status === "recovery"
        ? t("action.unlock")
        : t(vaultStatusI18nKey[status] as I18nKey)
      : undefined;
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
        accessibilityLabel={activateLabel}
        style={[
          styles.blockCard,
          { boxShadow: vaultRowBoxShadow(theme) },
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
              disabled={gripDisabled}
              label={dragHandleLabel}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            />
          ) : null}
          {blockIdentity}
          {actions}
        </View>
        <VaultLockButton
          status={status}
          layout="block"
          resumeUnlock={resumeOpen}
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
      accessibilityLabel={activateLabel}
      style={[
        styles.row,
        nested ? styles.memberRow : null,
        {
          paddingVertical: density.paddingY,
          paddingRight: density.paddingX,
          paddingLeft: showGrip ? Math.max(density.paddingX - 8, spacing.sm) : density.paddingX,
          boxShadow: vaultRowBoxShadow(theme),
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
          disabled={gripDisabled}
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
        appearance={comfortable ? "label" : "icon"}
        resumeUnlock={resumeOpen}
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
    alignSelf: "stretch",
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    overflow: "visible",
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
    padding: 14,
    borderRadius: radii.md,
    gap: spacing.sm,
    overflow: "visible",
  },
  blockTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  blockIdentity: { flex: 1, minWidth: 0, gap: 6 },
  blockTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  blockTitleText: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  blockMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    minWidth: 0,
  },
});
