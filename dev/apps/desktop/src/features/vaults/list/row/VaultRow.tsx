import { useMemo, useRef } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import {
  resolveVaultListStatus,
  vaultDisplayLetters,
  vaultRowChrome,
  type VaultListViewMode,
  type VaultListItem,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusRowClass } from "@/theme";
import { useElementWidth } from "@/hooks/useElementWidth";
import { vaultListDropOverClass } from "../lib/dropOverClass";
import { vaultListDropKeyProps } from "../lib/listDropKey";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLastOpenedIndicator } from "./VaultLastOpenedIndicator";
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
  isPipelineBusy: boolean;
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
  isPipelineBusy,
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
}: VaultRowProps) {
  const { t } = useTranslation();
  const { settings: appSettings } = useAppSettingsContext();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = status === "open";
  const isLastOpened = appSettings.app.last_opened_vault.trim() === vault.id;
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];
  const rowGap = viewMode === "large" ? "gap-4" : "gap-3";
  const articleRef = useRef<HTMLElement>(null);
  const estimatedWidth = useMemo(listWidthEstimate, []);
  const rowWidth = useElementWidth(articleRef, estimatedWidth);
  const comfortable = vaultRowChrome(rowWidth) === "comfortable";
  const lastAccessedLabel = t("vault.last_accessed", { when: vault.lastAccessedWhen });

  const openOrUnlock = () => {
    if (isReorderActive || isDragging) return;
    if (isOpen) onOpenFileManager(vault);
    else if (status === "closed" || status === "recovery") onUnlockVault(vault);
  };
  const rowActivates = isOpen || status === "closed" || status === "recovery";

  return (
    <article
      ref={articleRef}
      {...vaultListDropKeyProps(dropKey)}
      className={[
        "vault-row relative z-0 flex flex-row items-center justify-between overflow-visible rounded-xl px-4 transition-[opacity,box-shadow,background-color]",
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
          : status === "closed" || status === "recovery"
            ? t("action.unlock")
            : undefined
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
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
              <span className="truncate">{vault.displayName}</span>
              <VaultLastOpenedIndicator active={isLastOpened} />
              <VaultFileManagerIndicator vaultId={vault.id} />
              <VaultHiddenIndicator hidden={vault.hidden} />
            </h3>
            <div className="flex min-w-0 items-center gap-2">
              <VaultStatusBadge status={status} />
              <span
                className="flex min-w-0 items-center gap-1 text-xs text-on-surface-variant"
                title={lastAccessedLabel}
              >
                {!comfortable ? (
                  <Icon name="clock" size={12} className="shrink-0 text-on-surface-variant" />
                ) : null}
                <span className="min-w-0 truncate">
                  {comfortable ? lastAccessedLabel : vault.lastAccessedWhen}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center justify-end gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <VaultRowActions
          vault={vault}
          pipelineListStatus={pipelineListStatus}
          disabled={isPipelineBusy}
          includeLockAction={false}
          onOpenBackups={onOpenBackups}
          onOpenNote={onOpenNote}
          onOpenVaultInfo={onOpenVaultInfo}
          onOpenSettings={onOpenSettings}
          onExportVault={onExportVault}
          onOpenFolder={onOpenFolder}
          onOpenFileManager={onOpenFileManager}
          onLockVault={onLockVault}
          onUnlockVault={onUnlockVault}
        />
        <VaultLockButton
          status={status}
          appearance={comfortable ? "label" : "icon"}
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
        />
      </div>
    </article>
  );
}
