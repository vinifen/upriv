import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useAppSettingsContext } from "@/features/app-settings";
import { useTranslation } from "@/i18n";
import type { FileManagerEntry } from "./fileManagerTypes";

interface FileManagerDockProps {
  entries: readonly FileManagerEntry[];
  onRestore: (vaultId: string) => void;
  onClose: (vaultId: string) => void;
}

export function FileManagerDock({ entries, onRestore, onClose }: FileManagerDockProps) {
  const { t } = useTranslation();
  const { settings, patchSettings } = useAppSettingsContext();
  const expanded = settings.ui.file_manager_dock_expanded ?? false;

  if (entries.length === 0) return null;

  const toggleExpanded = () => {
    patchSettings({ ui: { file_manager_dock_expanded: !expanded } });
  };

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[110] flex w-[min(100vw-2rem,20rem)] flex-col items-stretch gap-2"
      aria-label={t("modal.file_manager.dock.label")}
    >
      {expanded ? (
        <div id="file-manager-dock-list" className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div
              key={entry.vaultId}
              className="flex items-center gap-2 rounded-xl bg-surface-container-high px-2 py-2 shadow-modal"
            >
              <button
                type="button"
                onClick={() => onRestore(entry.vaultId)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-container"
                aria-label={t("modal.file_manager.dock.restore", { name: entry.displayName })}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-accent">
                  <Icon name="folder" size={18} />
                </span>
                <span className="truncate text-sm font-medium text-on-surface">{entry.displayName}</span>
              </button>
              <IconButton
                label={t("modal.file_manager.action.close")}
                size="sm"
                className="shrink-0 rounded-lg"
                onClick={() => onClose(entry.vaultId)}
              >
                ×
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="file-manager-dock-list"
        className={[
          "flex items-center gap-2 rounded-xl bg-surface-container-high px-3 py-2.5 shadow-modal transition-colors hover:bg-surface-container",
          expanded ? "w-full" : "self-end",
        ].join(" ")}
        title={
          expanded
            ? t("modal.file_manager.dock.collapse")
            : t("modal.file_manager.dock.expand")
        }
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-accent">
          <Icon name="folder" size={18} />
        </span>
        <span className="min-w-[1.25rem] text-center text-sm font-semibold tabular-nums text-on-surface">
          {entries.length}
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={[
            "shrink-0 text-on-surface-variant transition-transform",
            expanded ? "rotate-180" : "",
          ].join(" ")}
        />
        <span className="sr-only">
          {expanded
            ? t("modal.file_manager.dock.collapse")
            : t("modal.file_manager.dock.expand")}
        </span>
      </button>
    </div>,
    document.body,
  );
}
