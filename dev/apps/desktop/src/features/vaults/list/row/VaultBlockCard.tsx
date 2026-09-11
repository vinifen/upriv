import { useTranslation } from "@/i18n";
import {
  resolveVaultListStatus,
  vaultDisplayLetters,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusRowClass } from "@/theme";
import { vaultListDropOverClass } from "../lib/dropOverClass";
import { vaultListDropKeyProps } from "../lib/listDropKey";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
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
  isPipelineBusy?: boolean;
  pointerDrag: VaultListPointerDragHandlers;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenVaultInfo: (vaultId: string) => void;
  onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
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
  isPipelineBusy = false,
  pointerDrag,
  onOpenBackups,
  onOpenNote,
  onOpenVaultInfo,
  onOpenSettings,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
}: VaultBlockCardProps) {
  const { t } = useTranslation();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = status === "open";
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;

  const openOrUnlock = () => {
    if (isReorderActive || isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    else if (status === "closed" || status === "recovery") onUnlockVault(vault);
  };
  const rowActivates = isOpen || status === "closed" || status === "recovery";

  return (
    <article
      {...vaultListDropKeyProps(dropKey)}
      className={[
        "vault-row relative z-0 flex min-h-[10rem] min-w-0 w-full flex-col justify-between overflow-visible rounded-xl p-3.5 transition-[opacity,box-shadow,background-color] sm:min-h-[10.5rem] sm:p-4",
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
          : status === "closed" || status === "recovery"
            ? t("action.unlock")
            : undefined
      }
    >
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {!dragDisabled ? (
          <VaultDragHandle
            disabled={dragDisabled}
            dropKey={dropKey}
            label={dragHandleLabel}
            onPointerDragStart={pointerDrag.onStart}
            onPointerDragMove={pointerDrag.onMove}
            onPointerDragEnd={pointerDrag.onEnd}
            onPointerDragCancel={pointerDrag.onCancel}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2">
          <div
            className={[
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10",
              vaultStatusIconClass[status],
            ].join(" ")}
            aria-hidden
          >
            <span className="text-[13px] font-semibold leading-none tracking-tight sm:text-[14px]">
              {vaultDisplayLetters(vault.displayName)}
            </span>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
            <h3 className="flex min-w-0 items-start gap-1.5 text-sm font-semibold leading-snug text-on-surface sm:text-base">
              <span className="line-clamp-2 min-w-0 flex-1">{vault.displayName}</span>
              <VaultLastOpenedIndicator active={isLastOpened} size={13} className="mt-0.5" />
              <VaultFileManagerIndicator vaultId={vault.id} size={13} className="mt-0.5" />
              <VaultHiddenIndicator hidden={vault.hidden} size={13} className="mt-0.5" />
            </h3>
            <div className="w-fit">
              <VaultStatusBadge status={status} />
            </div>
            <p className="text-[11px] leading-snug text-on-surface-variant sm:text-xs">
              {t("vault.last_accessed", { when: vault.lastAccessedWhen })}
            </p>
          </div>
        </div>
        <div
          className="flex shrink-0 self-stretch"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <VaultRowActions
            vault={vault}
            layout="column"
            pipelineListStatus={pipelineListStatus}
            disabled={isPipelineBusy}
            onOpenBackups={onOpenBackups}
            onOpenNote={onOpenNote}
            onOpenVaultInfo={onOpenVaultInfo}
            onOpenSettings={onOpenSettings}
            onExportVault={onExportVault}
            onOpenFolder={onOpenFolder}
            onOpenFileManager={onOpenFileManager}
          />
        </div>
      </div>

      <div
        className="shrink-0 pt-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <VaultLockButton
          status={status}
          layout="block"
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
        />
      </div>
    </article>
  );
}
