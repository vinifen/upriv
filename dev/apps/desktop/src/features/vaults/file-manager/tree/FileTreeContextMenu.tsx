import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { MenuPanelHeader } from "@/components/ui";
import { menuItemClass, menuPanelClass } from "@/components/ui/menuStyles";
import { useTranslation } from "@/i18n";
import { findNode, getParentPath, placeAnchoredMenu } from "@upriv/shared";
import type { FileTreeNode } from "@upriv/shared";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileTreeContextMenuProps {
  fm: FileManagerApi;
  tree: FileTreeNode;
}

interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
}

export function FileTreeContextMenu({ fm, tree }: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const menu = fm.workspace.contextMenu;
  const panelRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  const node = menu ? findNode(tree, menu.path) : null;
  const isRoot = menu?.path === "/";
  const isFolder = node?.type === "folder";
  const parentForCreate = menu && isFolder ? menu.path : menu ? getParentPath(menu.path) : "/";
  const title = isRoot
    ? t("modal.file_manager.explorer.title")
    : (node?.name ?? "");

  const close = () => fm.dispatch({ type: "set_context_menu", menu: null });

  const copyPath = async () => {
    if (!menu) return;
    close();
    try {
      await navigator.clipboard.writeText(menu.path);
      fm.showToast(t("modal.file_manager.toast.copied"));
    } catch {
      fm.showToast(t("modal.file_manager.toast.copy_failed"));
    }
  };

  const items: MenuItem[] = [];
  if (menu && node) {
    if (isFolder) {
      items.push(
        {
          id: "new-file",
          icon: "file",
          label: t("modal.file_manager.context.new_file"),
          onClick: () => fm.createFile(parentForCreate),
        },
        {
          id: "new-folder",
          icon: "folder",
          label: t("modal.file_manager.context.new_folder"),
          onClick: () => fm.createFolder(parentForCreate),
        },
      );
    }
    if (!isRoot) {
      items.push({
        id: "rename",
        icon: "pencil",
        label: t("modal.file_manager.context.rename"),
        onClick: () => fm.dispatch({ type: "start_rename", path: menu.path }),
      });
    }
    items.push(
      {
        id: "copy",
        icon: "copy",
        label: t("modal.file_manager.context.copy_path"),
        onClick: () => {
          void copyPath();
        },
      },
      {
        id: "open-system",
        icon: "file-manager",
        label: t("modal.file_manager.context.open_system"),
        onClick: () => {
          close();
          fm.showMockToast("open_system");
        },
      },
      {
        id: "open-terminal",
        icon: "terminal",
        label: t("modal.file_manager.context.open_terminal"),
        onClick: () => {
          close();
          fm.showMockToast("open_terminal");
        },
      },
    );
    if (!isRoot) {
      items.push({
        id: "delete",
        icon: "trash",
        label: t("modal.file_manager.context.delete"),
        onClick: () => fm.requestDelete(menu.path),
        danger: true,
      });
    }
  }

  useLayoutEffect(() => {
    if (!menu || !node) {
      setPlaced(null);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const spaceRight = window.innerWidth - pad - menu.x;
    const align = spaceRight < rect.width ? "right" : "left";
    const next = placeAnchoredMenu({
      anchor: { x: menu.x, y: menu.y, width: 1, height: 1 },
      panelWidth: rect.width,
      panelHeight: rect.height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      padding: { top: pad, right: pad, bottom: pad, left: pad },
      gap: 0,
      align,
    });
    setPlaced({ left: next.left, top: next.top });
  }, [menu, node, items.length, title]);

  if (!menu || !node) return null;

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
        ref={panelRef}
        className={[menuPanelClass, "fixed z-[121] w-max min-w-[12rem] max-w-[15rem] py-1"].join(
          " ",
        )}
        style={{
          left: placed?.left ?? menu.x,
          top: placed?.top ?? menu.y,
          visibility: placed ? "visible" : "hidden",
        }}
        role="menu"
        aria-label={title}
      >
        <MenuPanelHeader title={title} onClose={close} />
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={[
              menuItemClass,
              item.danger ? "!text-on-error-container" : "",
            ].join(" ")}
            style={item.danger ? { color: "var(--on-error-container)" } : undefined}
            onClick={() => {
              if (item.id !== "copy") close();
              item.onClick();
            }}
          >
            <Icon
              name={item.icon}
              size={16}
              className="shrink-0"
              style={
                item.danger
                  ? { color: "var(--on-error-container)" }
                  : { color: "var(--on-surface-variant)" }
              }
            />
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
