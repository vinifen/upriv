import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import {
  vaultRowControls,
  resolveVaultListStatus,
  isVaultOpenResumeTarget,
  vaultDisplayLetters,
  vaultLastAccessedLabel,
  vaultRowButtonRole,
  vaultRowButtonTwoStep,
  vaultRowClick,
  vaultRowClickLabelKey,
  vaultRowWorkClock,
  vaultStatusLabelKey,
  VAULT_ROW_DENSITY,
  type VaultListItem,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { ElapsedTime, TextWidthProbe } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { disarmRowButton, useRowArming, useRowButtonStack } from "@upriv/shared/react";
import { claimRowArmTouch } from "@/hooks/useRowArmingDismiss";
import { useTheme } from "@/theme";
import { radii, spacing, vaultRowBoxShadow } from "@/theme/tokens";
import { useVaultRowChrome } from "@/hooks/useVaultRowChrome";
import { vaultStatusIconColors, vaultStatusRowSurface } from "@/theme/vault-status";
import { DropOverRing } from "./DropOverRing";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
import { VaultPlaintextIndicator } from "./VaultPlaintextIndicator";
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
  dropTargetProps?: VaultRowDropTargetProps;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragCancel: () => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onOpenSettings: (vault: VaultListItem, area: VaultSettingsAreaId) => void;
  onUnlock: (vault: VaultListItem) => void;
  onLock: (vault: VaultListItem) => void;
  onCloseNow: (vault: VaultListItem) => void;
  /** Stop the work the row shows (`pipelineListStatus.rowWork`). */
  onStopWork: (vault: VaultListItem) => void;
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
  dropTargetProps,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onOpenFileManager,
  onOpenSettings,
  onUnlock,
  onLock,
  onCloseNow,
  onStopWork,
  onExport,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
}: VaultRowProps) {
  const { t, locale } = useTranslation();
  const { colors, typography, theme } = useTheme();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const statusLabelKey = vaultStatusLabelKey(
    status,
    vault.id,
    pipelineListStatus,
    vault.autoClosed === true,
  );
  const isOpen = status === "open";
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density = VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode];
  const blockTitleSize = VAULT_ROW_DENSITY.blocks.titleSize;
  const { chrome, onLayout: onChromeLayout } = useVaultRowChrome();
  const { stacked, measure } = useRowButtonStack();
  // A row with its buttons on their own line has the room for the full look.
  const comfortable = chrome === "comfortable" || stacked;
  const lastAccessedWhen = vaultLastAccessedLabel(vault, locale);
  const lastAccessedLabel = t("vault.last_accessed", { when: lastAccessedWhen });
  const lastAccessedText =
    variant === "block" || comfortable ? lastAccessedLabel : lastAccessedWhen;
  const work = pipelineListStatus.rowWork?.[vault.id] ?? null;
  const role = vaultRowButtonRole(status, work);
  const arming = useRowArming(vault.id, role, vaultRowButtonTwoStep(role, appSettings.ui));
  const claimTouch = () => claimRowArmTouch(vault.id);
  const resumeOpen = isVaultOpenResumeTarget(status, vault.id, pipelineListStatus);
  const rowClick = vaultRowClick(role, {
    open: isOpen,
    resumeOpen,
    runsButton: appSettings.ui.lifecycle_row_runs_button,
  });
  const activateRow = () => {
    if (isDragging || rowClick === null) return;
    if (rowClick === "file_manager") onOpenFileManager(vault);
    else if (rowClick === "resume_unlock") onUnlock(vault);
    // The button's own arming: a second tap may be needed, and a tap just after a role change does nothing.
    else if (role === "stop") arming.press(() => onStopWork(vault));
    else arming.press(() => onUnlock(vault));
  };
  const rowLabelKey = vaultRowClickLabelKey(role, rowClick);
  // A row that presses its button keeps that button armed for a tap anywhere on it.
  const claimRowTouch = rowClick === "button" ? claimTouch : undefined;
  // The work's elapsed time takes the last-accessed text's place.
  const lastAccessedOrElapsed = (
    <ElapsedTime
      startedAt={vaultRowWorkClock(work)}
      layout="inline"
      fallback={
        <Text style={[typography.caption, styles.meta]} numberOfLines={1}>
          {lastAccessedText}
        </Text>
      }
    />
  );
  const showGrip = dragEnabled;
  const gripDisabled = vaultRowControls(vault, pipelineListStatus).dragBlocked;
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
    measure("rowWidth", event.nativeEvent.layout.width);
    dropTargetProps?.onLayout?.();
  };

  const actions = (
    <VaultRowActions
      vault={vault}
      pipelineListStatus={pipelineListStatus}
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
      onCloseNow={onCloseNow}
      // Another control in the row puts an armed button back to normal.
      onTouchStart={claimRowTouch ? disarmRowButton : undefined}
    />
  );

  const identity = (
    <View style={styles.identity}>
      <View
        style={styles.titleRow}
        onLayout={(event) => measure("slotWidth", event.nativeEvent.layout.width)}
      >
        <TextWidthProbe
          text={vault.displayName}
          style={[styles.title, { fontSize: density.titleSize }]}
          onWidth={(width) => measure("textWidth", width)}
        />
        <Text
          style={[styles.title, { color: colors.onSurface, fontSize: density.titleSize }]}
          numberOfLines={1}
        >
          {vault.displayName}
        </Text>
        <View
          style={styles.titleMarks}
          onLayout={(event) => measure("besideWidth", event.nativeEvent.layout.width)}
        >
          <VaultPlaintextIndicator storageMode={vault.storageMode} />
          <VaultLastOpenedIndicator active={isLastOpened} />
          <VaultFileManagerIndicator vaultId={vault.id} />
          <VaultHiddenIndicator hidden={vault.hidden} />
        </View>
      </View>
      <View style={styles.metaRow}>
        <VaultStatusBadge status={status} labelKey={statusLabelKey} />
        <View style={styles.metaWhen} accessible accessibilityLabel={lastAccessedLabel}>
          {!comfortable ? <Icon name="clock" size={12} color={colors.onSurfaceVariant} /> : null}
          {lastAccessedOrElapsed}
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
          <VaultPlaintextIndicator storageMode={vault.storageMode} size={13} />
          <VaultLastOpenedIndicator active={isLastOpened} size={13} />
          <VaultFileManagerIndicator vaultId={vault.id} size={13} />
          <VaultHiddenIndicator hidden={vault.hidden} size={13} />
        </View>
      </View>
      <View style={styles.blockMetaRow}>
        <VaultStatusBadge status={status} labelKey={statusLabelKey} />
        <View style={styles.metaWhen} accessible accessibilityLabel={lastAccessedLabel}>
          {lastAccessedOrElapsed}
        </View>
      </View>
    </View>
  );

  const lockButton = (layout: "inline" | "block") => (
    <View onTouchStart={claimTouch} style={layout === "block" ? styles.blockLock : null}>
      <VaultLockButton
        status={status}
        role={role}
        armed={arming.armed}
        press={arming.press}
        layout={layout}
        appearance={layout === "block" || comfortable ? "label" : "icon"}
        resumeUnlock={resumeOpen}
        onLock={() => onLock(vault)}
        onUnlock={() => onUnlock(vault)}
        onStop={() => onStopWork(vault)}
      />
    </View>
  );
  const activateLabel = rowLabelKey ? t(rowLabelKey) : undefined;
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
        onTouchStart={claimRowTouch}
        onPress={rowLabelKey ? activateRow : undefined}
        accessibilityRole={rowLabelKey ? "button" : undefined}
        accessibilityLabel={activateLabel}
        style={[
          styles.blockCard,
          { boxShadow: vaultRowBoxShadow(theme) },
          vaultStatusRowSurface(status, colors),
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
          <View style={styles.blockIdentityTouch} onTouchStart={claimTouch}>
            {blockIdentity}
          </View>
          {actions}
        </View>
        {lockButton("block")}
      </Pressable>
    );
  }

  return (
    <Pressable
      {...dropTargetProps}
      onLayout={handleLayout}
      onTouchStart={claimRowTouch}
      onPress={rowLabelKey ? activateRow : undefined}
      accessibilityRole={rowLabelKey ? "button" : undefined}
      accessibilityLabel={activateLabel}
      style={[
        styles.row,
        stacked ? styles.rowStacked : null,
        nested ? styles.memberRow : null,
        {
          paddingVertical: density.paddingY,
          paddingRight: density.paddingX,
          paddingLeft: showGrip ? Math.max(density.paddingX - 8, spacing.sm) : density.paddingX,
          boxShadow: vaultRowBoxShadow(theme),
        },
        vaultStatusRowSurface(status, colors),
        isDragging ? { opacity: 0.45 } : null,
      ]}
    >
      {dropRing}
      <View style={styles.rowTop} onTouchStart={claimTouch}>
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
      </View>
      <View style={styles.rowButtons}>
        {actions}
        {lockButton("inline")}
      </View>
    </Pressable>
  );
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
  rowStacked: { flexDirection: "column", alignItems: "stretch", gap: spacing.sm },
  memberRow: { marginBottom: 0 },
  rowTop: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowButtons: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
  },
  rowPress: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  identity: { flex: 1, minWidth: 0, gap: 4, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  titleMarks: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8 },
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
  /** Carries the identity's flex so the touch marker does not change the layout. */
  blockIdentityTouch: { flex: 1, minWidth: 0 },
  blockLock: { alignSelf: "stretch" },
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
