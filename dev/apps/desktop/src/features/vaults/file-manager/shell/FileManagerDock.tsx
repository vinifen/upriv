import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { Collapse, IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import {
  DOCK_COLLAPSE_MS,
  DOCK_EXPAND_MS,
  DOCK_FADE_MS,
  vaultDisplayLetters,
  type FileManagerEntry,
} from "@upriv/shared";

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
  const motionMs = expanded ? DOCK_EXPAND_MS : DOCK_COLLAPSE_MS;

  if (entries.length === 0) return null;

  const highlightVaultId =
    focusedVaultId ?? maximizedVaultId ?? (entries.length === 1 ? entries[0].vaultId : null);

  const toggleExpanded = () => {
    void patchSettings({ ui: { file_manager_dock_expanded: !expanded } });
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
      className="fixed bottom-4 right-4 z-[110] grid w-max max-w-[min(100vw-2rem,14.5rem)] min-w-0 grid-cols-1 justify-items-stretch px-1.5"
      aria-label={t("modal.file_manager.dock.label")}
    >
      <Collapse open={expanded} openMs={DOCK_EXPAND_MS} closeMs={DOCK_COLLAPSE_MS}>
        <div
          id="file-manager-dock-list"
          className={[
            "grid grid-cols-1 gap-2.5 pb-2.5 pt-1 transition-opacity ease-out motion-reduce:transition-none",
            expanded ? "opacity-100" : "opacity-0",
          ].join(" ")}
          style={{ transitionDuration: `${DOCK_FADE_MS}ms` }}
        >
          {entries.map((entry) => {
            const active = entry.vaultId === highlightVaultId;
            const isMaximized = entry.vaultId === maximizedVaultId;
            const letters = vaultDisplayLetters(entry.displayName);
            return (
              <div
                key={entry.vaultId}
                role="button"
                tabIndex={expanded ? 0 : -1}
                onClick={() => handleEntryClick(entry.vaultId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleEntryClick(entry.vaultId);
                  }
                }}
                className={[
                  "dock-chip flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-surface-container-high px-2 py-2 transition-colors hover:bg-surface-container",
                  active ? "dock-entry-selected" : "",
                ].join(" ")}
                aria-label={
                  isMaximized
                    ? t("modal.file_manager.dock.minimize", { name: entry.displayName })
                    : t("modal.file_manager.dock.restore", { name: entry.displayName })
                }
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-accent"
                  aria-hidden
                >
                  <span
                    className={[
                      "font-semibold leading-none tracking-tight",
                      letters.length > 1 ? "text-[11px]" : "text-[12px]",
                    ].join(" ")}
                  >
                    {letters}
                  </span>
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface"
                  title={entry.displayName}
                >
                  {entry.displayName}
                </span>
                <div
                  className="flex shrink-0 items-center"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <IconButton
                    label={t("modal.file_manager.action.dismiss")}
                    size="sm"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => onDismiss(entry.vaultId)}
                  >
                    ×
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      </Collapse>

      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="file-manager-dock-list"
        className={[
          "dock-chip flex items-center justify-self-end rounded-xl bg-surface-container-high transition-colors hover:bg-surface-container",
          expanded ? "w-full min-w-0 gap-2 px-2 py-2" : "gap-1.5 px-2 py-1.5",
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
            "shrink-0 text-on-surface-variant transition-transform ease-out motion-reduce:transition-none",
            expanded ? "rotate-180" : "rotate-0",
          ].join(" ")}
          style={{ transitionDuration: `${motionMs}ms` }}
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
