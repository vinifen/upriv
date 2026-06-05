import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import type { VaultDisplayStatus } from "@/types";
import { resolveVaultDisplayStatus } from "@/types";
import {
  vaultStatusIconClass,
  vaultStatusRowClass,
} from "@/theme";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";
import type { VaultListViewMode } from "./vaultListView";
import { vaultRowDensityClass } from "./vaultListView";
import type { VaultListItem } from "./types";

interface VaultRowProps {
  vault: VaultListItem;
  viewMode: VaultListViewMode;
  dragDisabled: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
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
  viewMode,
  dragDisabled,
  isDragging,
  isDragOver,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onOpenFileManager,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: VaultRowProps) {
  const { t } = useTranslation();
  const status = resolveVaultDisplayStatus(vault);
  const isOpen = status === "open";
  const density =
    viewMode === "blocks" ? vaultRowDensityClass.default : vaultRowDensityClass[viewMode];

  return (
    <article
      className={[
        "vault-row flex flex-col items-center justify-between gap-6 overflow-visible rounded-xl px-4 transition-[opacity,box-shadow,background-color] sm:flex-row sm:pl-2 sm:pr-6",
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
        if (isOpen) onOpenFileManager(vault);
      }}
      onKeyDown={(event) => {
        if (isOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpenFileManager(vault);
        }
      }}
      role={isOpen ? "button" : undefined}
      tabIndex={isOpen ? 0 : undefined}
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
          onOpenBackups={onOpenBackups}
          onOpenNote={onOpenNote}
          onOpenSettings={onOpenSettings}
        />
        <VaultLockButton status={status} />
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
