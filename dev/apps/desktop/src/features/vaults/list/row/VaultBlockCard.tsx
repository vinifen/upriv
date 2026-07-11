import { Icon, type IconName } from "@/components/icons";
import { useTranslation } from "@/i18n";
import {
  resolveVaultCanSeal,
  resolveVaultListStatus,
  type VaultDisplayStatus,
  type VaultListItem,
} from "@upriv/shared";
import type { VaultPipelineListStatus } from "./VaultList";
import { vaultStatusIconClass, vaultStatusRowClass } from "@/theme";
import { VaultFileManagerIndicator } from "./VaultFileManagerIndicator";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultLockButton } from "./VaultLockButton";
import { VaultRowActions } from "./VaultRowActions";
import { VaultStatusBadge } from "./VaultStatusBadge";

interface VaultBlockCardProps {
  vault: VaultListItem;
  pipelineListStatus?: VaultPipelineListStatus;
  isPipelineBusy?: boolean;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onSealVault: (vault: VaultListItem) => void;
}

function statusIconName(status: VaultDisplayStatus, isOpen: boolean): IconName {
  if (isOpen) return "lock-open";
  if (status === "sealed") return "seal";
  return "lock";
}

export function VaultBlockCard({
  vault,
  pipelineListStatus = {},
  isPipelineBusy = false,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onSealVault,
}: VaultBlockCardProps) {
  const { t } = useTranslation();
  const status = resolveVaultListStatus(vault, pipelineListStatus);
  const isOpen = status === "open";

  return (
    <article
      className={[
        "vault-row flex min-h-[11.5rem] flex-col rounded-xl p-4 transition-[box-shadow,background-color] sm:min-h-[12rem] sm:p-5",
        vaultStatusRowClass[status],
        isOpen ? "cursor-pointer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
      <div className="flex items-start gap-2.5">
        <div
          className={[
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10",
            vaultStatusIconClass[status],
          ].join(" ")}
        >
          <Icon name={statusIconName(status, isOpen)} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-start gap-1.5 text-sm font-semibold leading-snug text-on-surface sm:text-base">
            <span className="line-clamp-2 min-w-0 flex-1">{vault.displayName}</span>
            <VaultFileManagerIndicator vaultId={vault.id} size={13} className="mt-0.5" />
            <VaultHiddenIndicator hidden={vault.hidden} size={13} className="mt-0.5" />
          </h3>
          <div className="mt-1.5">
            <VaultStatusBadge status={status} />
          </div>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-on-surface-variant sm:text-xs">
        {t("vault.last_accessed", { when: vault.lastAccessedWhen })}
      </p>

      <div
        className="mt-auto flex flex-col gap-2.5 pt-3"
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
          canSeal={resolveVaultCanSeal(vault)}
          layout="block"
          onLock={() => onLockVault(vault)}
          onUnlock={() => onUnlockVault(vault)}
          onSeal={() => onSealVault(vault)}
        />
      </div>
    </article>
  );
}
