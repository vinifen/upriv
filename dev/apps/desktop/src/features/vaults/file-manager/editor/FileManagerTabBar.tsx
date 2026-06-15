import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { isPathDirty } from "../lib/fileTreeTypes";
import { fileBaseName } from "@upriv/shared";
import type { VaultWorkspaceState } from "../lib/fileTreeTypes";
import type { VaultWorkspaceAction } from "../lib/vaultWorkspaceReducer";

interface FileManagerTabBarProps {
  workspace: VaultWorkspaceState;
  onWorkspaceAction: (action: VaultWorkspaceAction) => void;
  onSave?: () => void;
  showSave?: boolean;
}

export function FileManagerTabBar({
  workspace,
  onWorkspaceAction,
  onSave,
  showSave = false,
}: FileManagerTabBarProps) {
  const { t } = useTranslation();
  const { openTabs, activeTabPath } = workspace;

  if (openTabs.length === 0) {
    return (
      <div className="flex h-11 shrink-0 items-center bg-surface-container px-3 md:h-9 md:px-4">
        <span className="text-xs text-on-surface-variant">
          {t("modal.file_manager.tabs.empty")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-11 shrink-0 items-stretch bg-surface-container md:h-9">
      <div
        className="flex min-w-0 flex-1 overflow-x-auto"
        role="tablist"
        aria-label={t("modal.file_manager.tabs.label")}
      >
        {openTabs.map((path) => {
          const isActive = path === activeTabPath;
          const dirty = isPathDirty(workspace, path);
          return (
            <div
              key={path}
              role="presentation"
              className={[
                "group flex max-w-[14rem] shrink-0 items-stretch",
                isActive ? "bg-surface-container-high" : "bg-surface-container",
              ].join(" ")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onWorkspaceAction({ type: "set_active_tab", path })}
                className={[
                  "flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-xs transition-colors",
                  isActive
                    ? "text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
                ].join(" ")}
              >
                <Icon name="file" size={13} className="shrink-0 text-on-surface-variant" />
                <span className="truncate">
                  {fileBaseName(path)}
                  {dirty ? " *" : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onWorkspaceAction({ type: "request_close_tab", path })}
                className={[
                  "flex w-7 shrink-0 items-center justify-center text-on-surface-variant transition-opacity hover:bg-surface-container-highest hover:text-on-surface",
                  isActive ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                ].join(" ")}
                aria-label={t("modal.file_manager.tabs.close", { name: fileBaseName(path) })}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {showSave && onSave ? (
        <div className="flex shrink-0 items-center bg-surface-container-high px-2">
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onSave}>
            {t("modal.file_manager.viewer.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
