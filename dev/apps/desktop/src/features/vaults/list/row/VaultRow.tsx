import { useMemo, useRef } from "react";
import { Icon } from "@/components/icons";
import { ElapsedTime } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  vaultRowControls,
  resolveVaultListStatus,
  isVaultDeleteUnfinished,
  isVaultOpenResumeTarget,
  vaultDisplayLetters,
  vaultLastAccessedLabel,
  vaultRowButtonRole,
  vaultRowButtonTwoStep,
  vaultRowChrome,
  vaultRowClick,
  vaultRowClickLabelKey,
  vaultRowWorkClock,
  vaultStatusLabelKey,
  type VaultListViewMode,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { disarmRowButton, useRowArming } from "@upriv/shared/react";
import { ROW_ARM_ATTR } from "@/hooks/useRowArmingDismiss";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusRowClass } from "@/theme";
import { useElementWidth } from "@/hooks/useElementWidth";
import { vaultListDropOverClass } from "../lib/dropOverClass";
import { vaultListDropKeyProps } from "../lib/listDropKey";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
import { VaultPlainRecordLine } from "./VaultPlainRecordLine";
import { VaultPlaintextIndicator } from "./VaultPlaintextIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";
import { vaultRowDensityClass } from "../lib/vaultListView";
import type { VaultListPointerDragHandlers } from "./vaultListPointerDrag";
import { useAppSettingsContext } from "@/features/system/settings";

interface VaultRowProps {
  vault: VaultListItem;
  dropKey: string;
  pipelineListStatus?: VaultPipelineListStatus;
  viewMode: VaultListViewMode;
  dragDisabled: boolean;
  dragHandleLabel?: string;
  isDragging: boolean;
  isDragOver: boolean;
  isDropBlocked?: boolean;
  isReorderActive: boolean;
  pointerDrag: VaultListPointerDragHandlers;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenVaultInfo: (vaultId: string) => void;
  onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => void;
  onOpenDelete: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onCloseNow: (vault: VaultListItem) => void;
  onStopWork: (vault: VaultListItem) => void;
  /** Continue (`now` false) or Delete now (`now` true) for a vault being deleted. */
  onDeleteWork: (vault: VaultListItem, now: boolean) => void;
  /** Check a plain-text folder on record again. */
  onPlainRecordRetry: () => void;
  /** Forget a plain-text folder on record. */
  onPlainRecordForget: (vault: VaultListItem, token: string) => void;
}

function listWidthEstimate(): number {
  if (typeof window === "undefined") return 900;
  return Math.min(window.innerWidth, 900) - 48;
}

export function VaultRow({
  vault,
  dropKey,
  pipelineListStatus = {},
  viewMode,
  dragDisabled,
  dragHandleLabel,
  isDragging,
  isDragOver,
  isDropBlocked = false,
  isReorderActive,
  pointerDrag,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onOpenDelete,
  onExportVault,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onCloseNow,
  onStopWork,
  onDeleteWork,
  onPlainRecordRetry,
  onPlainRecordForget,
}: VaultRowProps) {
  const { t, locale } = useTranslation();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const statusLabelKey = vaultStatusLabelKey(status, vault.id, pipelineListStatus, vault);
  const isOpen = status === "open";
  const dragHeld = vaultRowControls(vault, pipelineListStatus).dragBlocked;
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];
  const rowGap = viewMode === "large" ? "gap-4" : "gap-3";
  const articleRef = useRef<HTMLElement>(null);
  const estimatedWidth = useMemo(listWidthEstimate, []);
  const rowWidth = useElementWidth(articleRef, estimatedWidth);
  // One line at every width: a narrow row drops the name circle and the
  // button labels, and the name truncates.
  const comfortable = vaultRowChrome(rowWidth) === "comfortable";
  const lastAccessedWhen = vaultLastAccessedLabel(vault, locale);
  const lastAccessedLabel = t("vault.last_accessed", { when: lastAccessedWhen });
  const work = pipelineListStatus.rowWork?.[vault.id] ?? null;
  const role = vaultRowButtonRole(status, work, isVaultDeleteUnfinished(vault, pipelineListStatus));
  const arming = useRowArming(vault.id, role, vaultRowButtonTwoStep(role, appSettings.ui));

  const resumeOpen = isVaultOpenResumeTarget(status, vault.id, pipelineListStatus);
  const rowClick = vaultRowClick(role, { open: isOpen, resumeOpen });
  const activateRow = () => {
    if (isReorderActive || isDragging || rowClick === null) return;
    if (rowClick === "file_manager") onOpenFileManager(vault);
    else if (rowClick === "resume_unlock") onUnlockVault(vault);
    // The button's own arming: a second press may be needed, and a press just after a role change does nothing.
    else if (role === "stop") arming.press(() => onStopWork(vault));
    else arming.press(() => onUnlockVault(vault));
  };
  const rowLabelKey = vaultRowClickLabelKey(role, rowClick);

  return (
    <article
      ref={articleRef}
      {...vaultListDropKeyProps(dropKey)}
      {...{ [ROW_ARM_ATTR]: vault.id }}
      className={[
        "vault-row relative z-0 flex min-w-0 w-full flex-row items-center justify-between overflow-visible rounded-xl px-4 transition-[opacity,box-shadow,background-color]",
        dragDisabled ? "pl-4" : "pl-2",
        "pr-4 sm:pr-6",
        rowGap,
        density.article,
        vaultStatusRowClass[status],
        rowLabelKey ? "cursor-pointer" : "",
        isDragging ? "opacity-45" : "",
        vaultListDropOverClass(isDragOver, isDropBlocked),
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={rowLabelKey ? activateRow : undefined}
      onKeyDown={(event) => {
        if (!rowLabelKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activateRow();
        }
      }}
      role={rowLabelKey ? "button" : undefined}
      tabIndex={rowLabelKey ? 0 : undefined}
      aria-label={rowLabelKey ? t(rowLabelKey) : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {!dragDisabled ? (
          <VaultDragHandle
            disabled={dragHeld}
            dropKey={dropKey}
            label={dragHandleLabel}
            onPointerDragStart={pointerDrag.onStart}
            onPointerDragMove={pointerDrag.onMove}
            onPointerDragEnd={pointerDrag.onEnd}
            onPointerDragCancel={pointerDrag.onCancel}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {comfortable ? (
            <div
              className={[
                "flex shrink-0 items-center justify-center rounded-full",
                density.icon,
                vaultStatusIconClass[status],
              ].join(" ")}
              aria-hidden
            >
              <span className={density.letters}>{vaultDisplayLetters(vault.displayName)}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3
              className={[
                "flex min-w-0 items-center gap-2 font-semibold text-on-surface",
                density.title,
              ].join(" ")}
            >
              <span className="truncate" title={vault.displayName}>
                {vault.displayName}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <VaultPlaintextIndicator storageMode={vault.storageMode} />
                <VaultLastOpenedIndicator active={isLastOpened} />
                <VaultFileManagerIndicator vaultId={vault.id} />
                <VaultHiddenIndicator hidden={vault.hidden} />
              </span>
            </h3>
            <div className="flex min-w-0 items-center gap-2">
              <VaultStatusBadge status={status} labelKey={statusLabelKey} />
              <ElapsedTime
                startedAt={vaultRowWorkClock(work)}
                layout="inline"
                fallback={
                  <span
                    className="flex min-w-0 items-center gap-1 text-xs text-on-surface-variant"
                    title={lastAccessedLabel}
                  >
                    {!comfortable ? (
                      <Icon name="clock" size={12} className="shrink-0 text-on-surface-variant" />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {comfortable ? lastAccessedLabel : lastAccessedWhen}
                    </span>
                  </span>
                }
              />
            </div>
            <VaultPlainRecordLine
              vault={vault}
              onRetry={onPlainRecordRetry}
              onForget={onPlainRecordForget}
            />
          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center justify-end gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {/* Another control in the row puts an armed button back to normal. */}
        <span className="contents" onPointerDownCapture={() => disarmRowButton()}>
          <VaultRowActions
            vault={vault}
            pipelineListStatus={pipelineListStatus}
            includeLockAction={false}
            onOpenBackups={onOpenBackups}
            onOpenNote={onOpenNote}
            onOpenVaultInfo={onOpenVaultInfo}
            onOpenSettings={onOpenSettings}
            onOpenDelete={onOpenDelete}
            onExportVault={onExportVault}
            onOpenFileManager={onOpenFileManager}
            onLockVault={onLockVault}
            onUnlockVault={onUnlockVault}
            onCloseNow={onCloseNow}
            onDeleteWork={onDeleteWork}
          />
        </span>
        <VaultLockButton
          vaultId={vault.id}
          status={status}
          role={role}
          armed={arming.armed}
          press={arming.press}
          appearance={comfortable ? "label" : "icon"}
          resumeUnlock={resumeOpen}
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
          onStop={() => onStopWork(vault)}
          onContinueDelete={() => onDeleteWork(vault, false)}
        />
      </div>
    </article>
  );
}
