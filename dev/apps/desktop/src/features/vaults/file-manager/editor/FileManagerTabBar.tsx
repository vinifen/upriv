import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { ContextMenu, IconButton, type ContextMenuItem } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { createSmoothScroller, wheelDeltaPx } from "@/lib/smoothWheelScroll";
import {
  fileBaseName,
  fileTabMenuAction,
  fileTabMenuItems,
  isPathDirty,
  sessionPathKind,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";

interface FileManagerTabBarProps {
  workspace: VaultWorkspaceState;
  onWorkspaceAction: (action: VaultWorkspaceAction) => void;
  onDelete: (path: string) => void;
  isPathPending: (path: string) => boolean;
  onSave?: () => void;
  showSave?: boolean;
  /** Pinned before the tabs (show-explorer toggle while the explorer is hidden). */
  leading?: ReactNode;
}

interface TabMenuState {
  x: number;
  y: number;
  path: string;
}

export function FileManagerTabBar({
  workspace,
  onWorkspaceAction,
  onDelete,
  isPathPending,
  onSave,
  showSave = false,
  leading,
}: FileManagerTabBarProps) {
  const { t } = useTranslation();
  const { openTabs, activeTabPath } = workspace;
  const tablistRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const dragSourceRef = useRef<string | null>(null);
  const didDragRef = useRef(false);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const saveLabel = t("modal.file_manager.viewer.save");

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabPath]);

  /* Vertical mouse wheel → horizontal tab scroll (trackpads already send deltaX). */
  useEffect(() => {
    const el = tablistRef.current;
    if (!el) return;

    const scroller = createSmoothScroller(el);
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;

      const { x, y } = wheelDeltaPx(event, el);
      const delta = Math.abs(x) > Math.abs(y) ? x : y;
      if (delta === 0) return;

      if (scroller.scrollBy(delta, 0)) event.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      scroller.dispose();
    };
  }, [openTabs.length]);

  const clearTabDrag = () => {
    dragSourceRef.current = null;
    setDragSourcePath(null);
    setDropTargetPath(null);
  };

  const leadingSlot = leading ? (
    <div className="flex min-h-8 shrink-0 self-stretch bg-surface-container">{leading}</div>
  ) : null;

  if (openTabs.length === 0) {
    return (
      <div className="flex h-8 shrink-0 items-center bg-surface-container-high">
        {leadingSlot}
        <span className="px-3 text-xs text-on-surface-variant md:px-4">
          {t("modal.file_manager.tabs.empty")}
        </span>
      </div>
    );
  }

  return (
    /* min-h-8 (not fixed h-8): thin overflow scrollbar grows the tab strip downward into the editor. */
    <div className="flex min-h-8 shrink-0 items-stretch bg-surface-container-high">
      {leadingSlot}
      <div
        ref={tablistRef}
        className="file-manager-tab-scroll flex min-h-8 min-w-0 flex-1 items-stretch bg-surface-container"
        role="tablist"
        aria-label={t("modal.file_manager.tabs.label")}
      >
        {openTabs.map((path) => {
          const isActive = path === activeTabPath;
          const dirty = isPathDirty(workspace, path);
          const pathKind = sessionPathKind(workspace, path);
          const name = fileBaseName(path);
          const isDragging = dragSourcePath === path;
          const isDropTarget = dropTargetPath === path && dragSourcePath !== path;

          const handleDragStart = (event: DragEvent) => {
            didDragRef.current = false;
            dragSourceRef.current = path;
            setDragSourcePath(path);
            setDropTargetPath(null);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", path);
          };

          const handleDragEnd = () => {
            clearTabDrag();
          };

          // A tab drag is the strip's own: the workspace around it would set
          // `copy` for an OS import, which a `move` drag refuses, and no drop
          // would follow.
          const handleDragOver = (event: DragEvent) => {
            const source = dragSourceRef.current;
            if (!source) return;
            event.stopPropagation();
            if (source === path) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            didDragRef.current = true;
            if (dropTargetPath !== path) setDropTargetPath(path);
          };

          const handleDrop = (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const source =
              dragSourceRef.current ?? event.dataTransfer.getData("text/plain") ?? null;
            if (source && source !== path) {
              onWorkspaceAction({ type: "reorder_tabs", fromPath: source, toPath: path });
            }
            clearTabDrag();
          };

          return (
            <div
              key={path}
              role="presentation"
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onContextMenu={(event) => {
                event.preventDefault();
                setTabMenu({ x: event.clientX, y: event.clientY, path });
              }}
              className={[
                "group flex h-8 max-w-[14rem] shrink-0 items-stretch self-start",
                isActive ? "bg-surface-container-high" : "bg-surface-container",
                isDragging ? "opacity-50" : "",
                isDropTarget ? "ring-1 ring-inset ring-[var(--accent)]" : "",
              ].join(" ")}
            >
              <button
                ref={isActive ? activeTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={name}
                onClick={() => {
                  if (didDragRef.current) {
                    didDragRef.current = false;
                    return;
                  }
                  onWorkspaceAction({ type: "set_active_tab", path });
                }}
                className={[
                  "flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-xs transition-colors",
                  dragSourcePath ? "cursor-grabbing" : "cursor-pointer",
                  isActive
                    ? "text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
                ].join(" ")}
              >
                <Icon
                  name="file"
                  size={12}
                  className={[
                    "shrink-0",
                    pathKind === "created"
                      ? "text-[var(--vault-status-open)]"
                      : pathKind === "modified"
                        ? "text-[var(--accent)]"
                        : "text-on-surface-variant",
                  ].join(" ")}
                />
                {/* The hidden name sets the width, so the dot takes room from the title. */}
                <span className="grid min-w-0">
                  <span className="invisible truncate [grid-area:1/1]" aria-hidden>
                    {name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 [grid-area:1/1]">
                    <span className="min-w-0 truncate">{name}</span>
                    {dirty ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-white" aria-hidden />
                    ) : null}
                  </span>
                </span>
              </button>
              <button
                type="button"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  onWorkspaceAction({ type: "request_close_tab", path });
                }}
                onDragStart={(event) => event.preventDefault()}
                className={[
                  "flex w-6 shrink-0 items-center justify-center text-on-surface-variant transition-opacity hover:bg-surface-container-highest hover:text-on-surface",
                  isActive ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                ].join(" ")}
                aria-label={t("modal.file_manager.tabs.close", { name })}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {showSave && onSave ? (
        <div className="flex min-w-0 shrink-0 self-stretch bg-surface-container-high">
          <IconButton
            label={saveLabel}
            size="sm"
            variant="ghost"
            className="!h-auto !min-h-8 !w-[3.25rem] !min-w-[3.25rem] !rounded-none self-stretch hover:!bg-surface-container-highest"
            onClick={onSave}
          >
            <Icon name="save" size={14} />
          </IconButton>
        </div>
      ) : null}
      {tabMenu && openTabs.includes(tabMenu.path) ? (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          title={fileBaseName(tabMenu.path)}
          items={fileTabMenuItems(openTabs, { pending: isPathPending(tabMenu.path) }).map(
            (item): ContextMenuItem => ({
              id: item.id,
              icon: item.icon,
              label: t(item.labelKey),
              danger: item.danger,
              onSelect: () => {
                const { path } = tabMenu;
                if (item.id === "delete") onDelete(path);
                else onWorkspaceAction(fileTabMenuAction(openTabs, path, item.id));
              },
            }),
          )}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
    </div>
  );
}
