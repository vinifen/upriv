import { ContextMenu, type ContextMenuItem } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { findNode, getParentPath } from "@upriv/shared";
import type { FileTreeNode } from "@upriv/shared";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileTreeContextMenuProps {
  fm: FileManagerApi;
  tree: FileTreeNode;
}

export function FileTreeContextMenu({ fm, tree }: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const menu = fm.workspace.contextMenu;
  const node = menu ? findNode(tree, menu.path) : null;
  if (!menu || !node) return null;

  const { path } = menu;
  const isRoot = path === "/";
  const isFolder = node.type === "folder";
  const parentForCreate = isFolder ? path : getParentPath(path);
  const title = isRoot ? t("modal.file_manager.explorer.title") : node.name;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      fm.showToast(t("modal.file_manager.toast.copied"));
    } catch {
      fm.showToast(t("modal.file_manager.toast.copy_failed"));
    }
  };

  const items: ContextMenuItem[] = [];
  if (isFolder) {
    items.push(
      {
        id: "new-file",
        icon: "file",
        label: t("modal.file_manager.context.new_file"),
        onSelect: () => fm.createFile(parentForCreate),
      },
      {
        id: "new-folder",
        icon: "folder",
        label: t("modal.file_manager.context.new_folder"),
        onSelect: () => fm.createFolder(parentForCreate),
      },
    );
  }
  if (!isRoot) {
    items.push({
      id: "rename",
      icon: "pencil",
      label: t("modal.file_manager.context.rename"),
      onSelect: () => fm.dispatch({ type: "start_rename", path }),
    });
  }
  items.push(
    {
      id: "copy",
      icon: "copy",
      label: t("modal.file_manager.context.copy_path"),
      onSelect: () => void copyPath(),
    },
    {
      id: "open-system",
      icon: "file-manager",
      label: t("modal.file_manager.context.open_system"),
      onSelect: () => void fm.openInSystemFileManager(path),
    },
    {
      id: "open-terminal",
      icon: "terminal",
      label: t("modal.file_manager.context.open_terminal"),
      onSelect: () => void fm.openInTerminal(path),
    },
  );
  if (!isRoot) {
    items.push({
      id: "delete",
      icon: "trash",
      label: t("modal.file_manager.context.delete"),
      onSelect: () => fm.requestDelete(path),
      danger: true,
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      title={title}
      items={items}
      onClose={() => fm.dispatch({ type: "set_context_menu", menu: null })}
    />
  );
}
