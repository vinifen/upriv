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
  vaultRowWorkClock,
  vaultStatusLabelKey,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { disarmRowButton, useRowArming } from "@upriv/shared/react";
import { ROW_ARM_ATTR } from "@/hooks/useRowArmingDismiss";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusI18nKey, vaultStatusRowClass } from "@/theme";
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
import type { VaultListPointerDragHandlers } from "./vaultListPointerDrag";
import { useAppSettingsContext } from "@/features/system/settings";

interface VaultBlockCardProps {
  vault: VaultListItem;
  dropKey: string;
  pipelineListStatus?: VaultPipelineListStatus;
  dragDisabled?: boolean;
  dragHandleLabel?: string;
  isDragging?: boolean;
  isDragOver?: boolean;
  isDropBlocked?: boolean;
  isReorderActive?: boolean;
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

export function VaultBlockCard({
  vault,
  dropKey,
  pipelineListStatus = {},
  dragDisabled = true,
  dragHandleLabel,
  isDragging = false,
  isDragOver = false,
  isDropBlocked = false,
  isReorderActive = false,
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
}: VaultBlockCardProps) {
  const { t, locale } = useTranslation();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const statusLabelKey = vaultStatusLabelKey(
    status,
    vault.id,
    pipelineListStatus,
    vault.autoClosed === true,
  );
  const work = pipelineListStatus.rowWork?.[vault.id] ?? null;
  const role = vaultRowButtonRole(status, work);
  const arming = useRowArming(vault.id, role, vaultRowButtonTwoStep(role, appSettings.ui));
  const isOpen = status === "open";
  const dragHeld = vaultRowControls(vault, pipelineListStatus).dragBlocked;
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;

  const resumeOpen = isVaultOpenResumeTarget(status, vault.id, pipelineListStatus);
  const canUnlockFromRow =
    isVaultListRowUnlockTarget(status) && (status !== "queued" || resumeOpen);
  const openOrUnlock = () => {
    if (isReorderActive || isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    // A click on the card is Unlock, with the button's guard: a click just after Stop turned into Unlock does nothing.
    else if (role === "unlock") arming.press(() => onUnlockVault(vault));
    else if (canUnlockFromRow) onUnlockVault(vault);
  };
  const rowActivates = isVaultListRowActivatable(status) && (status !== "queued" || resumeOpen);

  return (
    <article
      {...vaultListDropKeyProps(dropKey)}
      {...{ [ROW_ARM_ATTR]: vault.id }}
      className={[
        "vault-row relative z-0 flex min-h-0 min-w-0 w-full flex-col gap-2.5 overflow-visible rounded-xl p-3.5 transition-[opacity,box-shadow,background-color] sm:gap-3 sm:p-4",
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
      <div className="flex min-w-0 items-start gap-2">
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
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10",
                vaultStatusIconClass[status],
              ].join(" ")}
              aria-hidden
            >
              <span className="text-[13px] font-semibold leading-none tracking-tight sm:text-[14px]">
                {vaultDisplayLetters(vault.displayName)}
              </span>
            </div>
            <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold leading-snug text-on-surface sm:text-base">
              <span className="line-clamp-2 min-w-0 flex-1">{vault.displayName}</span>
              <VaultPlaintextIndicator storageMode={vault.storageMode} size={13} />
              <VaultLastOpenedIndicator active={isLastOpened} size={13} />
              <VaultFileManagerIndicator vaultId={vault.id} size={13} />
              <VaultHiddenIndicator hidden={vault.hidden} size={13} />
            </h3>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <VaultStatusBadge status={status} labelKey={statusLabelKey} />
            <ElapsedTime
              startedAt={vaultRowWorkClock(work)}
              layout="inline"
              fallback={
                <p className="min-w-0 flex-1 text-[11px] leading-snug text-on-surface-variant sm:text-xs">
                  {t("vault.last_accessed", { when: vaultLastAccessedLabel(vault, locale) })}
                </p>
              }
            />
          </div>
        </div>
        <div
          className="flex shrink-0 self-stretch"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDownCapture={() => disarmRowButton()}
        >
          <VaultRowActions
            vault={vault}
            layout="column"
            pipelineListStatus={pipelineListStatus}
            onOpenBackups={onOpenBackups}
            onOpenNote={onOpenNote}
            onOpenVaultInfo={onOpenVaultInfo}
            onOpenSettings={onOpenSettings}
            onExportVault={onExportVault}
            onOpenFileManager={onOpenFileManager}
            onCloseNow={onCloseNow}
          />
        </div>
      </div>

      <div
        className="shrink-0"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <VaultLockButton
          vaultId={vault.id}
          status={status}
          role={role}
          armed={arming.armed}
          press={arming.press}
          layout="block"
          resumeUnlock={resumeOpen}
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
          onStop={() => onStopWork(vault)}
        />
      </div>
    </article>
  );
}
