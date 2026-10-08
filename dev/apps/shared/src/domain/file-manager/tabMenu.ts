import type { I18nKey } from "../../i18n/catalog";
import type { IconName } from "../icons";
import type { VaultWorkspaceAction } from "./workspaceReducer";

export type FileTabMenuItemId = "close" | "close_others" | "close_all" | "rename" | "delete";

export interface FileTabMenuItem {
  id: FileTabMenuItemId;
  icon: IconName;
  labelKey: I18nKey;
  danger?: boolean;
}

const FILE_TAB_MENU_ITEMS = {
  close: { id: "close", icon: "close", labelKey: "modal.file_manager.tabs.menu.close" },
  close_others: {
    id: "close_others",
    icon: "file",
    labelKey: "modal.file_manager.tabs.menu.close_others",
  },
  close_all: {
    id: "close_all",
    icon: "layers",
    labelKey: "modal.file_manager.tabs.menu.close_all",
  },
  rename: { id: "rename", icon: "pencil", labelKey: "modal.file_manager.context.rename" },
  delete: {
    id: "delete",
    icon: "trash",
    labelKey: "modal.file_manager.context.delete",
    danger: true,
  },
} as const satisfies Record<FileTabMenuItemId, FileTabMenuItem>;

/**
 * Menu on an open-file tab (desktop right-click, mobile double-tap).
 * Pending imports cannot be renamed or deleted yet, same as the explorer menu.
 */
export function fileTabMenuItems(
  openTabs: readonly string[],
  options: { pending: boolean },
): FileTabMenuItem[] {
  const ids: FileTabMenuItemId[] = ["close"];
  if (openTabs.length > 1) ids.push("close_others", "close_all");
  if (!options.pending) ids.push("rename", "delete");
  return ids.map((id) => FILE_TAB_MENU_ITEMS[id]);
}

/** Workspace action for a tab menu item. `delete` goes through the file manager (confirm + RPC). */
export function fileTabMenuAction(
  openTabs: readonly string[],
  path: string,
  id: Exclude<FileTabMenuItemId, "delete">,
): VaultWorkspaceAction {
  switch (id) {
    case "close":
      return { type: "request_close_tab", path };
    case "close_others":
      return { type: "request_close_tabs", paths: openTabs.filter((tab) => tab !== path) };
    case "close_all":
      return { type: "request_close_tabs", paths: [...openTabs] };
    case "rename":
      return { type: "start_rename", path };
  }
}
