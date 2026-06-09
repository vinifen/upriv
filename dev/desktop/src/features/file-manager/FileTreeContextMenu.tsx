import { createPortal } from "react-dom";
import { menuItemClass, menuPanelClass } from "@/components/ui/menuStyles";
import { useTranslation } from "@/i18n";
import { findTreeNode } from "./fileTreeUtils";
import type { FileTreeNode } from "./fileTreeTypes";
import type { useVaultFileManager } from "./useVaultFileManager";

type FileManagerApi = ReturnType<typeof useVaultFileManager>;

interface FileTreeContextMenuProps {
  fm: FileManagerApi;
  tree: FileTreeNode;
}

export function FileTreeContextMenu({ fm, tree }: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const menu = fm.workspace.contextMenu;
  if (!menu) return null;

  const node = findTreeNode(tree, menu.path);
  if (!node) return null;

  const isRoot = menu.path === "/";
  const isFolder = node.type === "folder";
  const parentForCreate = isFolder ? menu.path : menu.path.slice(0, menu.path.lastIndexOf("/")) || "/";

  const close = () => fm.dispatch({ type: "set_context_menu", menu: null });

  const copyPath = async () => {
    close();
    try {
      await navigator.clipboard.writeText(menu.path);
      fm.showToast(t("modal.file_manager.toast.copied"));
    } catch {
      fm.showToast(t("modal.file_manager.toast.copy_failed"));
    }
  };

  const items: { id: string; label: string; onClick: () => void; danger?: boolean }[] = [];

  if (isFolder) {
    items.push(
      {
        id: "new-file",
        label: t("modal.file_manager.context.new_file"),
        onClick: () => fm.createFile(parentForCreate),
      },
      {
        id: "new-folder",
        label: t("modal.file_manager.context.new_folder"),
        onClick: () => fm.createFolder(parentForCreate),
      },
    );
  }

  if (!isRoot) {
    items.push(
      {
        id: "rename",
        label: t("modal.file_manager.context.rename"),
        onClick: () => fm.dispatch({ type: "start_rename", path: menu.path }),
      },
      {
        id: "delete",
        label: t("modal.file_manager.context.delete"),
        onClick: () => fm.requestDelete(menu.path),
        danger: true,
      },
    );
  }

  items.push(
    {
      id: "copy",
      label: t("modal.file_manager.context.copy_path"),
      onClick: copyPath,
    },
    {
      id: "open-system",
      label: t("modal.file_manager.context.open_system"),
      onClick: () => {
        close();
        fm.showMockToast("open_system");
      },
    },
    {
      id: "open-terminal",
      label: t("modal.file_manager.context.open_terminal"),
      onClick: () => {
        close();
        fm.showMockToast("open_terminal");
      },
    },
  );

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120]"
        onClick={close}
        onContextMenu={(event) => {
          event.preventDefault();
          close();
        }}
      />
      <div
        className={[menuPanelClass, "fixed z-[121] min-w-[12rem] py-1"].join(" ")}
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={[menuItemClass, item.danger ? "text-on-error-container" : ""].join(" ")}
            onClick={() => {
              if (item.id !== "copy") close();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
