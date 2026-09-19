import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  fileBaseName,
  isPathDirty,
  sessionPathKind,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";

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
  const tablistRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const dragSourceRef = useRef<string | null>(null);
  const didDragRef = useRef(false);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const saveLabel = t("modal.file_manager.viewer.save");

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabPath]);

  /* Vertical mouse wheel → horizontal tab scroll (trackpads already send deltaX). */
  useEffect(() => {
    const el = tablistRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;

      const next = Math.min(maxScroll, Math.max(0, el.scrollLeft + delta));
      if (next === el.scrollLeft) return;

      el.scrollLeft = next;
      event.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [openTabs.length]);

  const clearTabDrag = () => {
    dragSourceRef.current = null;
    setDragSourcePath(null);
    setDropTargetPath(null);
  };

  if (openTabs.length === 0) {
    return (
      <div className="flex h-8 shrink-0 items-center bg-surface-container-high px-3 md:px-4">
        <span className="text-xs text-on-surface-variant">
          {t("modal.file_manager.tabs.empty")}
        </span>
      </div>
    );
  }

  return (
    /* min-h-8 (not fixed h-8): thin overflow scrollbar grows the tab strip downward into the editor. */
    <div className="flex min-h-8 shrink-0 items-stretch bg-surface-container-high">
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

          const handleDragOver = (event: DragEvent) => {
            const source = dragSourceRef.current;
            if (!source || source === path) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            didDragRef.current = true;
            if (dropTargetPath !== path) setDropTargetPath(path);
          };

          const handleDrop = (event: DragEvent) => {
            event.preventDefault();
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
                  "flex min-w-0 flex-1 cursor-grab items-center gap-1.5 px-2 text-left text-xs transition-colors active:cursor-grabbing",
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
                <span className="min-w-0 truncate">{name}</span>
                {dirty ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-white" aria-hidden />
                ) : null}
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
        <div className="flex min-w-0 shrink-0 items-center justify-center self-stretch bg-surface-container-high px-1.5">
          <IconButton
            label={saveLabel}
            size="sm"
            variant="ghost"
            className="!h-7 !w-8 !min-h-7 !min-w-8"
            onClick={onSave}
          >
            <Icon name="save" size={14} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
