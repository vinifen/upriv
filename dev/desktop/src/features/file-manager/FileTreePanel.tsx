import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { getParentPath, isDescendantPath } from "./fileTreeOps";
import type { FileTreeNode } from "./fileTreeTypes";
import { joinPath } from "./fileTreeUtils";
import type { useVaultFileManager } from "./useVaultFileManager";

type FileManagerApi = ReturnType<typeof useVaultFileManager>;

interface FileTreePanelProps {
  fm: FileManagerApi;
  splitPercent: number;
  layout: "row" | "column";
}

interface FileTreeRowProps {
  node: FileTreeNode;
  path: string;
  depth: number;
  fm: FileManagerApi;
}

const TWISTIE_COL = "0.75rem";
const ICON_COL = "0.875rem";
const ROW_GRID = `${TWISTIE_COL} ${ICON_COL} minmax(0, 1fr)`;
const DEPTH_INDENT_PX = 10;

function FileTreeRow({ node, path, depth, fm }: FileTreeRowProps) {
  const { workspace, dispatch, commitRename, movePath } = fm;
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && workspace.expandedPaths.includes(path);
  const isSelected = workspace.selectedPath === path;
  const isRenaming = workspace.renamingPath === path;
  const isDragging = workspace.dragSourcePath === path;
  const isDropTarget = workspace.dropTargetPath === path && isFolder;
  const isRoot = path === "/";
  const longPressRef = useRef<number | null>(null);
  const [renameValue, setRenameValue] = useState(node.name);

  useEffect(() => {
    if (isRenaming) setRenameValue(node.name);
  }, [isRenaming, node.name]);

  const openContextMenu = (clientX: number, clientY: number) => {
    dispatch({ type: "set_context_menu", menu: { x: clientX, y: clientY, path } });
    dispatch({ type: "select_path", path });
  };

  const handleActivate = () => {
    if (isRenaming) return;
    if (isFolder) {
      dispatch({ type: "toggle_folder", path });
      return;
    }
    dispatch({ type: "open_file", path });
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    longPressRef.current = window.setTimeout(() => {
      openContextMenu(event.clientX, event.clientY);
    }, 500);
  };

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleDragStart = (event: DragEvent) => {
    if (isRoot) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
    dispatch({ type: "set_drag", source: path, target: null });
  };

  const handleDragEnd = () => {
    dispatch({ type: "set_drag", source: null, target: null });
  };

  const handleDragOver = (event: DragEvent) => {
    if (!isFolder) return;
    const source = workspace.dragSourcePath;
    if (!source || source === path || isDescendantPath(source, path)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (workspace.dropTargetPath !== path) {
      dispatch({ type: "set_drag", source, target: path });
      dispatch({ type: "expand_folder", path });
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const from = workspace.dragSourcePath ?? event.dataTransfer.getData("text/plain");
    if (from && isFolder && !isDescendantPath(from, path)) movePath(from, path);
    dispatch({ type: "set_drag", source: null, target: null });
  };

  const finishRename = () => {
    commitRename(path, renameValue);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        draggable={!isRoot && !isRenaming}
        onClick={handleActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleActivate();
          }
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={isFolder ? handleDragOver : undefined}
        onDrop={isFolder ? handleDrop : undefined}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        className={[
          "grid w-full min-w-0 cursor-pointer items-center gap-x-0.5 rounded-md py-1 text-left text-xs outline-none transition-colors",
          isSelected
            ? "bg-surface-container-highest/80 text-on-surface"
            : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
          isDragging ? "opacity-50" : "",
          isDropTarget ? "ring-1 ring-[var(--accent)]" : "",
        ].join(" ")}
        style={{
          gridTemplateColumns: ROW_GRID,
          paddingLeft: `${depth * DEPTH_INDENT_PX + 2}px`,
        }}
      >
        {isFolder ? (
          <Icon
            name="chevron-down"
            size={13}
            className={[
              "shrink-0 text-on-surface-variant transition-transform",
              isExpanded ? "" : "-rotate-90",
            ].join(" ")}
          />
        ) : (
          <span className="shrink-0" aria-hidden />
        )}
        <Icon
          name={isFolder ? "folder" : "file"}
          size={14}
          className="shrink-0 text-on-surface-variant"
        />
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishRename();
              if (e.key === "Escape") dispatch({ type: "cancel_rename" });
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 w-full rounded bg-surface-container-highest px-1.5 py-0.5 text-xs text-on-surface outline-none ring-1 ring-[var(--accent)]"
          />
        ) : (
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
        )}
      </div>
      {isFolder && isExpanded
        ? node.children?.map((child) => (
            <FileTreeRow
              key={joinPath(path, child.name)}
              node={child}
              path={joinPath(path, child.name)}
              depth={depth + 1}
              fm={fm}
            />
          ))
        : null}
    </>
  );
}

function FileTreeRoot({ tree, fm }: { tree: FileTreeNode; fm: FileManagerApi }) {
  if (tree.type === "folder" && tree.children?.length) {
    return (
      <>
        {tree.children.map((child) => (
          <FileTreeRow
            key={joinPath("/", child.name)}
            node={child}
            path={joinPath("/", child.name)}
            depth={0}
            fm={fm}
          />
        ))}
      </>
    );
  }

  return <FileTreeRow node={tree} path="/" depth={0} fm={fm} />;
}

export function FileTreePanel({ fm, splitPercent, layout }: FileTreePanelProps) {
  const { t } = useTranslation();
  const paneStyle =
    layout === "column"
      ? { height: `${splitPercent}%`, width: "100%" }
      : { width: `${splitPercent}%`, height: "100%" };

  const openRootContextMenu = (clientX: number, clientY: number) => {
    fm.dispatch({ type: "set_context_menu", menu: { x: clientX, y: clientY, path: "/" } });
    fm.dispatch({ type: "select_path", path: "/" });
  };

  const handleNavContextMenu = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    openRootContextMenu(event.clientX, event.clientY);
  };

  const handleNavDragOver = (event: DragEvent) => {
    const source = fm.workspace.dragSourcePath;
    if (!source || getParentPath(source) === "/") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (fm.workspace.dropTargetPath !== "/") {
      fm.dispatch({ type: "set_drag", source, target: "/" });
    }
  };

  const handleNavDrop = (event: DragEvent) => {
    event.preventDefault();
    const from = fm.workspace.dragSourcePath ?? event.dataTransfer.getData("text/plain");
    if (from && getParentPath(from) !== "/") fm.movePath(from, "/");
    fm.dispatch({ type: "set_drag", source: null, target: null });
  };

  const rootDropActive = fm.workspace.dropTargetPath === "/";

  return (
    <aside
      style={paneStyle}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-container"
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-2">
        <p className="min-w-0 flex-1 font-mono text-[10px] font-medium uppercase tracking-widest text-on-surface-variant">
          {t("modal.file_manager.explorer.title")}
        </p>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          onClick={() => fm.createFile("/")}
          aria-label={t("modal.file_manager.context.new_file")}
          title={t("modal.file_manager.context.new_file")}
        >
          <Icon name="file" size={14} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          onClick={() => fm.createFolder("/")}
          aria-label={t("modal.file_manager.context.new_folder")}
          title={t("modal.file_manager.context.new_folder")}
        >
          <Icon name="folder" size={14} />
        </button>
      </div>
      <nav
        className={[
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-1.5 pt-0",
          rootDropActive ? "ring-1 ring-inset ring-[var(--accent)]" : "",
        ].join(" ")}
        aria-label={t("modal.file_manager.explorer.title")}
        onContextMenu={handleNavContextMenu}
        onDragOver={handleNavDragOver}
        onDrop={handleNavDrop}
      >
        <FileTreeRoot tree={fm.tree} fm={fm} />
      </nav>
    </aside>
  );
}
