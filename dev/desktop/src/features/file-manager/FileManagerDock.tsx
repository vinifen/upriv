import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/app-settings";
import { useTranslation } from "@/i18n";
import type { FileManagerEntry } from "./fileManagerTypes";

interface FileManagerDockProps {
  entries: readonly FileManagerEntry[];
  focusedVaultId: string | null;
  maximizedVaultId: string | null;
  onMinimize: (vaultId: string) => void;
  onRestore: (vaultId: string) => void;
  onDismiss: (vaultId: string) => void;
}

export function FileManagerDock({
  entries,
  focusedVaultId,
  maximizedVaultId,
  onMinimize,
  onRestore,
  onDismiss,
}: FileManagerDockProps) {
  const { t } = useTranslation();
  const { settings, patchSettings } = useAppSettingsContext();
  const expanded = settings.ui.file_manager_dock_expanded ?? false;

  if (entries.length === 0) return null;

  const highlightVaultId =
    focusedVaultId ?? maximizedVaultId ?? (entries.length === 1 ? entries[0].vaultId : null);

  const toggleExpanded = () => {
    patchSettings({ ui: { file_manager_dock_expanded: !expanded } });
  };

  const handleEntryClick = (vaultId: string) => {
    if (vaultId === maximizedVaultId) {
      onMinimize(vaultId);
      return;
    }
    onRestore(vaultId);
  };

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[110] flex w-[min(100vw-2rem,14.5rem)] min-w-0 flex-col items-end gap-2"
      aria-label={t("modal.file_manager.dock.label")}
    >
      {expanded ? (
        <div id="file-manager-dock-list" className="flex w-full min-w-0 flex-col gap-2">
          {entries.map((entry) => {
            const active = entry.vaultId === highlightVaultId;
            const isMaximized = entry.vaultId === maximizedVaultId;
            return (
              <div
                key={entry.vaultId}
                className={[
                  "flex w-full min-w-0 items-center gap-2 rounded-xl bg-surface-container-high px-2 py-2 shadow-modal",
                  active ? "dock-entry-selected" : "",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => handleEntryClick(entry.vaultId)}
                  className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-container"
                  aria-label={
                    isMaximized
                      ? t("modal.file_manager.dock.minimize", { name: entry.displayName })
                      : t("modal.file_manager.dock.restore", { name: entry.displayName })
                  }
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-accent">
                    <Icon name="folder" size={18} />
                  </span>
                  <span
                    className="min-w-0 truncate text-sm font-medium text-on-surface"
                    title={entry.displayName}
                  >
                    {entry.displayName}
                  </span>
                </button>
                <IconButton
                  label={t("modal.file_manager.action.dismiss")}
                  size="sm"
                  className="shrink-0 rounded-lg"
                  onClick={() => onDismiss(entry.vaultId)}
                >
                  ×
                </IconButton>
              </div>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="file-manager-dock-list"
        className={[
          "flex items-center rounded-lg bg-surface-container-high shadow-modal transition-colors hover:bg-surface-container",
          expanded ? "w-full min-w-0 gap-2 px-2.5 py-2" : "gap-1.5 px-2 py-1.5",
        ].join(" ")}
        title={
          expanded ? t("modal.file_manager.dock.collapse") : t("modal.file_manager.dock.expand")
        }
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-container text-accent">
          <Icon name="folder" size={16} />
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-0.5 text-[10px] font-bold leading-none tabular-nums text-accent-foreground"
          >
            {entries.length}
          </span>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={[
            "shrink-0 text-on-surface-variant transition-transform",
            expanded ? "rotate-180" : "",
          ].join(" ")}
        />
        <span className="sr-only">
          {expanded ? t("modal.file_manager.dock.collapse") : t("modal.file_manager.dock.expand")} (
          {entries.length})
        </span>
      </button>
    </div>,
    document.body,
  );
}
