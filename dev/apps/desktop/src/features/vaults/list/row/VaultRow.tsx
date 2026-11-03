import { useMemo, useRef } from "react";
import { Icon } from "@/components/icons";
import { ElapsedTime } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  vaultRowControls,
  resolveVaultListStatus,
  isVaultListRowActivatable,
  isVaultListRowUnlockTarget,
  isVaultOpenResumeTarget,
  vaultDisplayLetters,
  vaultLastAccessedLabel,
  vaultRowButtonRole,
  vaultRowButtonTwoStep,
  vaultRowChrome,
  vaultRowWorkClock,
  vaultStatusLabelKey,
  type VaultListViewMode,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { disarmRowButton, useRowArming } from "@upriv/shared/react";
import { ROW_ARM_ATTR } from "@/hooks/useRowArmingDismiss";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusI18nKey, vaultStatusRowClass } from "@/theme";
import { useElementWidth } from "@/hooks/useElementWidth";
import { useRowButtonsBelow } from "@/hooks/useRowButtonsBelow";
import { vaultListDropOverClass } from "../lib/dropOverClass";
import { vaultListDropKeyProps } from "../lib/listDropKey";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
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
  onExportVault: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onCloseNow: (vault: VaultListItem) => void;
  onStopWork: (vault: VaultListItem) => void;
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
  onExportVault,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onCloseNow,
  onStopWork,
}: VaultRowProps) {
  const { t, locale } = useTranslation();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const statusLabelKey = vaultStatusLabelKey(
    status,
    vault.id,
    pipelineListStatus,
    vault.autoClosed === true,
  );
  const isOpen = status === "open";
  const dragHeld = vaultRowControls(vault, pipelineListStatus).dragBlocked;
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];
  const rowGap = viewMode === "large" ? "gap-4" : "gap-3";
  const articleRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const marksRef = useRef<HTMLSpanElement>(null);
  const estimatedWidth = useMemo(listWidthEstimate, []);
  const rowWidth = useElementWidth(articleRef, estimatedWidth);
  const buttonsBelow = useRowButtonsBelow(
    { row: articleRef, slot: titleRef, text: nameRef, beside: marksRef },
    vault.displayName,
  );
  // A row with its buttons on their own line has the room for the full look.
  const comfortable = vaultRowChrome(rowWidth) === "comfortable" || buttonsBelow;
  const lastAccessedWhen = vaultLastAccessedLabel(vault, locale);
  const lastAccessedLabel = t("vault.last_accessed", { when: lastAccessedWhen });
  const work = pipelineListStatus.rowWork?.[vault.id] ?? null;
  const role = vaultRowButtonRole(status, work);
  const arming = useRowArming(vault.id, role, vaultRowButtonTwoStep(role, appSettings.ui));

  const resumeOpen = isVaultOpenResumeTarget(status, vault.id, pipelineListStatus);
  const canUnlockFromRow =
    isVaultListRowUnlockTarget(status) && (status !== "queued" || resumeOpen);
  const openOrUnlock = () => {
    if (isReorderActive || isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    // A click on the row is Unlock, with the button's guard: a click just after Stop turned into Unlock does nothing.
    else if (role === "unlock") arming.press(() => onUnlockVault(vault));
    else if (canUnlockFromRow) onUnlockVault(vault);
  };
  const rowActivates = isVaultListRowActivatable(status) && (status !== "queued" || resumeOpen);

  return (
    <article
      ref={articleRef}
      {...vaultListDropKeyProps(dropKey)}
      {...{ [ROW_ARM_ATTR]: vault.id }}
      className={[
        "vault-row relative z-0 flex min-w-0 w-full justify-between overflow-visible rounded-xl px-4 transition-[opacity,box-shadow,background-color]",
        buttonsBelow ? "flex-col items-stretch" : "flex-row items-center",
        dragDisabled ? "pl-4" : "pl-2",
        "pr-4 sm:pr-6",
        rowGap,
        density.article,
        vaultStatusRowClass[status],
        rowActivates ? "cursor-pointer" : "",
        isDragging ? "opacity-45" : "",
        vaultListDropOverClass(isDragOver, isDropBlocked),
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={openOrUnlock}
      onKeyDown={(event) => {
        if (!rowActivates) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openOrUnlock();
        }
      }}
      role={rowActivates ? "button" : undefined}
      tabIndex={rowActivates ? 0 : undefined}
      aria-label={
        isOpen
          ? t("action.open_upriv")
          : canUnlockFromRow
            ? status === "closed" || status === "recovery"
              ? t("action.unlock")
              : t(vaultStatusI18nKey[status])
            : undefined
      }
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
              ref={titleRef}
              className={[
                "flex min-w-0 items-center gap-2 font-semibold text-on-surface",
                density.title,
              ].join(" ")}
            >
              <span ref={nameRef} className="truncate">
                {vault.displayName}
              </span>
              <span ref={marksRef} className="flex shrink-0 items-center gap-2">
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
            onExportVault={onExportVault}
            onOpenFileManager={onOpenFileManager}
            onLockVault={onLockVault}
            onUnlockVault={onUnlockVault}
            onCloseNow={onCloseNow}
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
        />
      </div>
    </article>
  );
}
