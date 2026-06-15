import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import {
  resolveVaultListStatus,
  type VaultDisplayStatus,
  type VaultListViewMode,
  type VaultListItem,
} from "@upriv/shared";
import { vaultStatusIconClass, vaultStatusRowClass } from "@/theme";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";
import { vaultRowDensityClass } from "../lib/vaultListView";

interface VaultRowProps {
  vault: VaultListItem;
  pipelineOpeningVaultId?: string | null;
  viewMode: VaultListViewMode;
  dragDisabled: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  isReorderActive: boolean;
  isPipelineBusy: boolean;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onSealVault: (vault: VaultListItem) => void;
  onDragStart: (vaultId: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (vaultId: string) => (event: React.DragEvent) => void;
  onDragLeave: (vaultId: string) => () => void;
  onDrop: (vaultId: string) => (event: React.DragEvent) => void;
}

function statusIconName(status: VaultDisplayStatus, isOpen: boolean): IconName {
  if (isOpen) return "lock-open";
  if (status === "sealed") return "seal";
  return "lock";
}

export function VaultRow({
  vault,
  pipelineOpeningVaultId = null,
  viewMode,
  dragDisabled,
  isDragging,
  isDragOver,
  isReorderActive,
  isPipelineBusy,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onSealVault,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: VaultRowProps) {
  const { t } = useTranslation();
  const status = resolveVaultListStatus(vault, pipelineOpeningVaultId);
  const isOpen = status === "open";
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];
  const rowGap = viewMode === "large" ? "gap-7" : "gap-6";

  return (
    <article
      className={[
        "vault-row flex flex-col items-center justify-between overflow-visible rounded-xl px-4 transition-[opacity,box-shadow,background-color] sm:flex-row sm:pl-2 sm:pr-6",
        rowGap,
        density.article,
        vaultStatusRowClass[status],
        isOpen ? "cursor-pointer" : "",
        isDragging ? "opacity-45" : "",
        isDragOver ? "ring-2 ring-accent/40 ring-offset-2 ring-offset-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={onDragOver(vault.id)}
      onDragLeave={onDragLeave(vault.id)}
      onDrop={onDrop(vault.id)}
      onClick={() => {
        if (isOpen && !isReorderActive && !isDragging) onOpenFileManager(vault);
      }}
      onKeyDown={(event) => {
        if (isOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpenFileManager(vault);
        }
      }}
      role={isOpen ? "button" : undefined}
      tabIndex={isOpen ? 0 : undefined}
      aria-label={isOpen ? t("action.open_upriv") : undefined}
    >
      <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
        <VaultDragHandle
          vaultId={vault.id}
          disabled={dragDisabled}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <div
          className={[
            "flex shrink-0 items-center justify-center rounded-full",
            density.icon,
            vaultStatusIconClass[status],
          ].join(" ")}
        >
          <Icon name={statusIconName(status, isOpen)} size={density.iconSize} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
            <StatusDotInline status={status} className="col-start-1 row-start-1" />
            <h3
              className={[
                "col-start-2 row-start-1 flex min-w-0 items-center gap-1.5 font-semibold text-on-surface",
                density.title,
              ].join(" ")}
            >
              <span className="truncate">{vault.displayName}</span>
              <VaultFileManagerIndicator vaultId={vault.id} />
              <VaultHiddenIndicator hidden={vault.hidden} />
            </h3>
            <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-2">
              <VaultStatusBadge status={status} />
              <span className="text-xs text-on-surface-variant">
                {t("vault.last_accessed", { when: vault.lastAccessedWhen })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex w-full items-center justify-end gap-3 sm:w-auto"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <VaultRowActions
          vault={vault}
          disabled={isPipelineBusy}
          onOpenBackups={onOpenBackups}
          onOpenNote={onOpenNote}
          onOpenSettings={onOpenSettings}
          onExportVault={onExportVault}
          onOpenFolder={onOpenFolder}
          onOpenFileManager={onOpenFileManager}
        />
        <VaultLockButton
          status={status}
          storageMode={vault.storageMode}
          canSeal={vault.canSeal}
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
          onSeal={() => onSealVault(vault)}
        />
      </div>
    </article>
  );
}

function StatusDotInline({
  status,
  className = "",
}: {
  status: VaultDisplayStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={[
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full self-center",
        className,
        status === "open" ? "bg-vault-open shadow-[0_0_8px_var(--vault-open-glow)]" : "",
        status === "closed" ? "bg-vault-closed" : "",
        status === "sealed" ? "bg-vault-sealed" : "",
        status === "recovery" ? "bg-vault-recovery" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
