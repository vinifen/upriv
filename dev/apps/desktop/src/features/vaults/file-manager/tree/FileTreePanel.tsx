import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  findNode,
  getParentPath,
  isDescendantPath,
  isImportQueueSlotPath,
  isImportWalkPlaceholderPath,
  liveFileNameError,
  fileNameErrorI18nKey,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  renameBasenameSelection,
  searchTreeRows,
  sessionPathKind,
  visibleTreeRows,
  type FolderPresence,
  type SessionPathKind,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useSearchCollapsedFolders } from "@upriv/shared/react";
import { allowFileManagerDrop, beginOsFileImport, filesFromFileInput } from "../lib/osFileDrop";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { ExplorerSearch } from "./ExplorerSearch";
import { treeDropZoneEdges, type TreeDropZoneEdge } from "./treeDropZone";

interface FileTreePanelProps {
  fm: FileManagerApi;
  /** The explorer's own element: a divider drag sizes it directly. */
  paneRef?: Ref<HTMLElement>;
  splitPercent: number;
  layout: "row" | "column";
}

/**
 * What every row may do. One object for the explorer's life, so a row draws
 * again only when its own marks change, not when the file manager does.
 */
interface FileTreeRowActions {
  dispatch: (action: VaultWorkspaceAction) => void;
  toggleFolder: (path: string) => void;
  openFile: (path: string) => void;
  commitRename: (path: string, name: string) => void;
  movePath: (fromPath: string, toFolderPath: string) => void;
  importOsDrop: FileManagerApi["importOsDrop"];
  showError: (error: unknown) => void;
  /** The drag as it is now. Hovering one row does not draw the others. */
  drag: () => { source: string | null; target: string | null };
}

interface FileTreeRowProps {
  path: string;
  name: string;
  isFolder: boolean;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isDirty: boolean;
  pathKind: SessionPathKind | null;
  isRenaming: boolean;
  isDragging: boolean;
  dropZone: TreeDropZoneEdge | null;
  isPending: boolean;
  isWalkPlaceholder: boolean;
  isQueueSlot: boolean;
  isProcessing: boolean;
  /** How much of this entry is in a chosen-files vault's folder. */
  folderMark: FolderPresence | null;
  actions: FileTreeRowActions;
}

const TWISTIE_COL = "0.75rem";
const ICON_COL = "0.875rem";
const ROW_GRID = `${TWISTIE_COL} ${ICON_COL} minmax(0, 1fr)`;
const DEPTH_INDENT_PX = 10;

/** Outline around the folder under a drag and its rows, one edge per row. */
const DROP_ZONE_SHADOW: Record<TreeDropZoneEdge, string> = {
  single: "inset 0 0 0 1px var(--accent)",
  first: "inset 1px 1px 0 0 var(--accent), inset -1px 0 0 0 var(--accent)",
  middle: "inset 1px 0 0 0 var(--accent), inset -1px 0 0 0 var(--accent)",
  last: "inset 1px -1px 0 0 var(--accent), inset -1px 0 0 0 var(--accent)",
};

const DROP_ZONE_ROUNDING: Record<TreeDropZoneEdge, string> = {
  single: "rounded-sm",
  first: "rounded-t-sm",
  middle: "",
  last: "rounded-b-sm",
};

function importTargetPath(fm: FileManagerApi): string {
  const selected = fm.workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(fm.tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}

const FileTreeRow = memo(function FileTreeRow({
  path,
  name,
  isFolder,
  depth,
  isExpanded,
  isSelected,
  isDirty,
  pathKind,
  isRenaming,
  isDragging,
  dropZone,
  isPending,
  isWalkPlaceholder,
  isQueueSlot,
  isProcessing,
  folderMark,
  actions,
}: FileTreeRowProps) {
  const { t } = useTranslation();
  const { dispatch } = actions;
  const isRoot = path === "/";
  const longPressRef = useRef<number | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState(name);
  const renameError = isRenaming ? liveFileNameError(renameValue) : null;

  useEffect(() => {
    if (isRenaming) setRenameValue(name);
  }, [isRenaming, name]);

  const openContextMenu = (clientX: number, clientY: number) => {
    dispatch({ type: "set_context_menu", menu: { x: clientX, y: clientY, path } });
    dispatch({ type: "select_path", path });
  };

  const handleActivate = () => {
    if (isRenaming || isWalkPlaceholder || isQueueSlot) return;
    if (isFolder) {
      actions.toggleFolder(path);
      return;
    }
    actions.openFile(path);
  };

  const handleContextMenu = (event: MouseEvent) => {
    if (isPending || isQueueSlot) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY);
  };

  const clearLongPress = () => {
    pressOriginRef.current = null;
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || isPending || isWalkPlaceholder || isQueueSlot) return;
    pressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressRef.current = window.setTimeout(() => {
      openContextMenu(event.clientX, event.clientY);
    }, FILE_MANAGER_LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const origin = pressOriginRef.current;
    if (!origin || !longPressRef.current) return;
    if (
      Math.abs(event.clientX - origin.x) > FILE_MANAGER_LONG_PRESS_MOVE_PX ||
      Math.abs(event.clientY - origin.y) > FILE_MANAGER_LONG_PRESS_MOVE_PX
    ) {
      clearLongPress();
    }
  };

  useEffect(() => {
    return () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    };
  }, []);

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

  const dropFolderPath = isFolder ? path : getParentPath(path);

  const handleDragOver = (event: DragEvent) => {
    const { source, target } = actions.drag();
    if (source) {
      if (isDescendantPath(source, dropFolderPath)) {
        event.stopPropagation();
        allowFileManagerDrop(event, "none");
        if (target) {
          dispatch({ type: "set_drag", source, target: null });
        }
        return;
      }
      allowFileManagerDrop(event, "move");
      event.stopPropagation();
      if (target !== dropFolderPath) {
        dispatch({ type: "set_drag", source, target: dropFolderPath });
      }
      return;
    }

    allowFileManagerDrop(event, "copy");
    event.stopPropagation();
    if (target !== dropFolderPath) {
      dispatch({ type: "set_drag", source: null, target: dropFolderPath });
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (beginOsFileImport(event, dropFolderPath, actions.importOsDrop, actions.showError)) {
      dispatch({ type: "set_drag", source: null, target: null });
      return;
    }

    const from = actions.drag().source ?? event.dataTransfer.getData("text/plain");
    if (from && !isDescendantPath(from, dropFolderPath)) actions.movePath(from, dropFolderPath);
    dispatch({ type: "set_drag", source: null, target: null });
  };

  const finishRename = (fromBlur = false) => {
    if (renameError) {
      if (fromBlur) dispatch({ type: "cancel_rename" });
      return;
    }
    actions.commitRename(path, renameValue);
  };

  return (
    <div
      role={isRenaming ? undefined : "button"}
      tabIndex={isRenaming ? -1 : 0}
      draggable={!isRoot && !isRenaming && !isPending && !isQueueSlot}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (isRenaming) return;
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleActivate();
        }
      }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      className={[
        "grid w-full min-w-0 cursor-pointer items-center gap-x-0.5 py-1 text-left text-xs outline-none transition-colors",
        isSelected
          ? "bg-[color-mix(in_srgb,var(--on-surface)_6%,transparent)] text-on-surface hover:bg-surface-container-highest"
          : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
        isDragging ? "opacity-50" : "",
        isProcessing ? "animate-pulse" : isPending ? "opacity-75" : "",
        dropZone ? DROP_ZONE_ROUNDING[dropZone] : "",
      ].join(" ")}
      aria-busy={isProcessing ? true : undefined}
      style={{
        gridTemplateColumns: ROW_GRID,
        paddingLeft: `${depth * DEPTH_INDENT_PX + 2}px`,
        boxShadow: dropZone ? DROP_ZONE_SHADOW[dropZone] : undefined,
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
        className={[
          "shrink-0",
          pathKind === "created"
            ? "text-[var(--vault-status-open)]"
            : pathKind === "modified"
              ? "text-[var(--accent)]"
              : "text-on-surface-variant",
        ].join(" ")}
      />
      {isRenaming ? (
        <div className="min-w-0">
          <input
            autoFocus
            value={renameValue}
            maxLength={LOGICAL_FILE_NAME_MAX_LENGTH}
            onChange={(e) => setRenameValue(e.target.value)}
            onFocus={(e) => {
              const { start, end } = renameBasenameSelection(e.currentTarget.value);
              e.currentTarget.setSelectionRange(start, end);
            }}
            onBlur={() => finishRename(true)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={renameError ? true : undefined}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                finishRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                dispatch({ type: "cancel_rename" });
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 w-full rounded bg-surface-container-highest px-1.5 py-0.5 text-xs text-on-surface outline-none ring-1 ring-[var(--accent)]"
          />
          {renameError ? (
            <p role="alert" className="mt-0.5 text-[10px] leading-tight text-on-error-container">
              {t(
                fileNameErrorI18nKey(renameError),
                renameError === "too_long"
                  ? { max: String(LOGICAL_FILE_NAME_MAX_LENGTH) }
                  : undefined,
              )}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {isQueueSlot ? (
            <span className="min-w-0 truncate italic">
              {t("modal.file_manager.import.folder_pending")}
            </span>
          ) : isWalkPlaceholder ? (
            <span className="h-2.5 w-24 shrink-0 rounded bg-on-surface-variant/20" aria-hidden />
          ) : (
            <span className="min-w-0 truncate">{name}</span>
          )}
          {isDirty ? (
            <span className="size-1.5 shrink-0 rounded-full bg-white" aria-hidden />
          ) : null}
          {folderMark === "all" || folderMark === "some" ? (
            <FolderMark partial={folderMark === "some"} />
          ) : null}
        </span>
      )}
    </div>
  );
});

function FolderMark({ partial }: { partial: boolean }) {
  const { t } = useTranslation();
  const label = t(
    partial
      ? "modal.file_manager.explorer.partly_in_folder"
      : "modal.file_manager.explorer.in_folder",
  );
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={[
        "ml-auto mr-1 shrink-0 text-on-surface-variant",
        partial ? "opacity-50" : "",
      ].join(" ")}
    >
      <Icon name="plaintext" size={11} aria-hidden />
    </span>
  );
}

const TREE_SKELETON_ROWS = [
  { depth: 0, width: "w-24" },
  { depth: 0, width: "w-32" },
  { depth: 1, width: "w-20" },
  { depth: 1, width: "w-28" },
  { depth: 0, width: "w-16" },
  { depth: 0, width: "w-24" },
] as const;

function FileTreeSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse motion-reduce:animate-none">
      {TREE_SKELETON_ROWS.map((row, index) => (
        <div
          key={index}
          aria-hidden
          className="grid items-center gap-x-0.5 py-1"
          style={{
            gridTemplateColumns: ROW_GRID,
            paddingLeft: `${row.depth * DEPTH_INDENT_PX + 2}px`,
          }}
        >
          <span />
          <span className="size-3.5 rounded-sm bg-on-surface-variant/20" />
          <span className={`h-2.5 rounded bg-on-surface-variant/20 ${row.width}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * Every visible row, flat and depth first. A row draws again only when its own
 * marks change: typing, a divider drag, or opening another file leave the rest.
 * A search shows its matches with the folders that lead to them, open. Those
 * folders collapse for that search only; the saved ones stay as they are.
 */
function FileTreeRows({ fm, search }: { fm: FileManagerApi; search: string }) {
  const { t } = useTranslation();
  const { displayTree, folderPresence, workspace, pendingImportPaths, processingImportPaths } = fm;
  const searching = search.trim().length > 0;
  const { collapsed: searchCollapsed, toggle: toggleSearchFolder } = useSearchCollapsedFolders(
    fm.vaultId,
    search,
  );
  const fmRef = useRef(fm);
  fmRef.current = fm;
  const toggleFolderRef = useRef<(path: string) => void>(() => undefined);
  toggleFolderRef.current = (path) => {
    if (searching) toggleSearchFolder(path);
    else fm.dispatch({ type: "toggle_folder", path });
  };
  const [actions] = useState<FileTreeRowActions>(() => ({
    dispatch: (action) => fmRef.current.dispatch(action),
    toggleFolder: (path) => toggleFolderRef.current(path),
    openFile: (path) => fmRef.current.openFile(path),
    commitRename: (path, name) => fmRef.current.commitRename(path, name),
    movePath: (fromPath, toFolderPath) => fmRef.current.movePath(fromPath, toFolderPath),
    importOsDrop: (parentPath, snapshot, options) =>
      fmRef.current.importOsDrop(parentPath, snapshot, options),
    showError: (error) => fmRef.current.showError(error),
    drag: () => ({
      source: fmRef.current.workspace.dragSourcePath,
      target: fmRef.current.workspace.dropTargetPath,
    }),
  }));

  const rows = useMemo(
    () =>
      searching
        ? searchTreeRows(displayTree, search, {
            renamingPath: workspace.renamingPath,
            collapsed: searchCollapsed,
          })
        : visibleTreeRows(displayTree, workspace.expandedPaths),
    [
      displayTree,
      search,
      searchCollapsed,
      searching,
      workspace.expandedPaths,
      workspace.renamingPath,
    ],
  );
  const expanded = useMemo(() => new Set(workspace.expandedPaths), [workspace.expandedPaths]);
  const dirty = useMemo(() => new Set(workspace.dirtyPaths), [workspace.dirtyPaths]);
  const dropZones = useMemo(
    () => treeDropZoneEdges(rows, workspace.dropTargetPath),
    [rows, workspace.dropTargetPath],
  );
  const {
    activeTabPath,
    renamingPath,
    dragSourcePath,
    sessionCreatedPaths,
    sessionModifiedPaths,
    dirtyPaths,
  } = workspace;

  // The same elements while nothing a row shows changed, so React skips them all.
  return useMemo(() => {
    const kinds = { sessionCreatedPaths, sessionModifiedPaths, dirtyPaths };
    const rowProps = (path: string, name: string, isFolder: boolean, depth: number) => {
      const isWalkPlaceholder = isImportWalkPlaceholderPath(path);
      const isQueueSlot = isImportQueueSlotPath(path);
      return {
        path,
        name,
        isFolder,
        depth,
        isExpanded: isFolder && (searching ? !searchCollapsed.has(path) : expanded.has(path)),
        isSelected: activeTabPath === path,
        isDirty: !isFolder && dirty.has(path),
        pathKind: sessionPathKind(kinds, path),
        isRenaming: renamingPath === path,
        isDragging: dragSourcePath === path,
        dropZone: dropZones.get(path) ?? null,
        isPending: pendingImportPaths.has(path),
        isWalkPlaceholder,
        isQueueSlot,
        isProcessing: processingImportPaths.has(path) || isWalkPlaceholder || isQueueSlot,
        folderMark: folderPresence?.get(path) ?? null,
        actions,
      };
    };
    if (rows.length === 0 && searching) {
      return (
        <p role="status" className="px-3 py-2 text-xs text-on-surface-variant">
          {t("modal.file_manager.explorer.search_empty")}
        </p>
      );
    }
    if (rows.length === 0) {
      // An empty vault shows its root folder.
      return <FileTreeRow {...rowProps("/", displayTree.name, displayTree.type === "folder", 0)} />;
    }
    return rows.map((row) => (
      <FileTreeRow
        key={row.path}
        {...rowProps(row.path, row.node.name, row.node.type === "folder", row.depth)}
      />
    ));
  }, [
    actions,
    activeTabPath,
    dirty,
    dirtyPaths,
    displayTree,
    dragSourcePath,
    dropZones,
    expanded,
    folderPresence,
    pendingImportPaths,
    processingImportPaths,
    renamingPath,
    rows,
    searchCollapsed,
    searching,
    sessionCreatedPaths,
    sessionModifiedPaths,
    t,
  ]);
}

/** Icon + "Explorer" hide the explorer; the icon alone (in the tab bar) shows it again. */
export function ExplorerToggle({ fm, showLabel }: { fm: FileManagerApi; showLabel: boolean }) {
  const { t } = useTranslation();
  const collapsed = fm.workspace.explorerCollapsed;
  const label = t(
    collapsed ? "modal.file_manager.explorer.show" : "modal.file_manager.explorer.hide",
  );
  return (
    <button
      type="button"
      onClick={() => fm.dispatch({ type: "set_explorer_collapsed", collapsed: !collapsed })}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className={[
        "flex text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface",
        // Wrapping is decided on the icon-only basis, so the label truncates away entirely before the actions wrap.
        showLabel
          ? "h-6 min-w-6 max-w-max flex-[1_1_1.5rem] items-center rounded"
          : "w-8 shrink-0 self-stretch items-start justify-center",
      ].join(" ")}
    >
      <span
        className={["flex w-6 shrink-0 justify-center", showLabel ? "" : "h-8 items-center"].join(
          " ",
        )}
      >
        <Icon name="sidebar" size={14} />
      </span>
      {showLabel ? (
        <span className="min-w-0 truncate font-mono text-[10px] font-medium uppercase tracking-widest">
          {t("modal.file_manager.explorer.title")}
        </span>
      ) : null}
    </button>
  );
}

const EXPLORER_TOOL_PAIR_CLASS =
  "flex shrink-0 [@container(width<9rem)]:flex-1 [@container(width<9rem)]:justify-around";

function ExplorerToolButton({
  icon,
  label,
  pressed,
  active = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  /** A toggle's state. A plain action leaves it out. */
  pressed?: boolean;
  /** Still at work with its panel closed. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors",
        pressed
          ? "bg-surface-container-highest text-on-surface"
          : active
            ? "text-[var(--accent)] hover:bg-surface-container-highest"
            : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
      ].join(" ")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

export function FileTreePanel({ fm, paneRef, splitPercent, layout }: FileTreePanelProps) {
  const { t } = useTranslation();
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** The button opened the bar, so typing starts there. A restored bar leaves focus alone. */
  const focusSearchRef = useRef(false);
  const { explorerSearchOpen: searchOpen, explorerSearchQuery: search } = fm.workspace;
  // A large vault filters behind the typing, not in its way.
  const deferredSearch = useDeferredValue(search);
  const searchAtWork = !searchOpen && search.trim().length > 0;
  useEffect(() => {
    if (searchOpen && focusSearchRef.current) searchInputRef.current?.focus();
    focusSearchRef.current = false;
  }, [searchOpen]);
  const setSearchOpen = (open: boolean) => {
    focusSearchRef.current = open;
    fm.dispatch({ type: "set_explorer_search_open", open });
  };
  const extent = `${splitPercent}%`;
  const paneStyle: CSSProperties = {
    ...(layout === "column"
      ? { height: extent, width: "100%" }
      : { width: extent, height: "100%" }),
    display: splitPercent === 0 ? "none" : undefined,
  };

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
    if (event.target !== event.currentTarget) return;

    const source = fm.workspace.dragSourcePath;
    if (source) {
      if (getParentPath(source) === "/") {
        allowFileManagerDrop(event, "none");
        return;
      }
      allowFileManagerDrop(event, "move");
      if (fm.workspace.dropTargetPath !== "/") {
        fm.dispatch({ type: "set_drag", source, target: "/" });
      }
      return;
    }

    allowFileManagerDrop(event, "copy");
    if (fm.workspace.dropTargetPath !== "/") {
      fm.dispatch({ type: "set_drag", source: null, target: "/" });
    }
  };

  const handleNavDrop = (event: DragEvent) => {
    if (event.target !== event.currentTarget) return;

    event.preventDefault();

    if (beginOsFileImport(event, "/", fm.importOsDrop, fm.showError)) {
      fm.dispatch({ type: "set_drag", source: null, target: null });
      return;
    }

    const from = fm.workspace.dragSourcePath ?? event.dataTransfer.getData("text/plain");
    if (from && getParentPath(from) !== "/") fm.movePath(from, "/");
    fm.dispatch({ type: "set_drag", source: null, target: null });
  };

  const rootDropActive = fm.workspace.dropTargetPath === "/";

  const openImportFilesPicker = () => {
    importFilesInputRef.current?.click();
  };

  const openImportFolderPicker = () => {
    importFolderInputRef.current?.click();
  };

  const handleImportFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromFileInput(event.target.files);
    event.target.value = "";
    if (files.length === 0) return;
    void fm.importFiles(importTargetPath(fm), files, { openFirstViewable: true });
  };

  const handleImportFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromFileInput(event.target.files);
    event.target.value = "";
    if (files.length === 0) return;
    void fm.importFiles(importTargetPath(fm), files, { openFirstViewable: true });
  };

  return (
    <aside
      ref={paneRef}
      style={paneStyle}
      className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-surface-container"
    >
      {/*
        Label truncates first; once only the icon is left, the actions wrap by group
        (create, import, search). They wrap below 9rem of content (label icon + five
        buttons), and then spread evenly across their own rows.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-y-0.5 px-1 pb-0.5 pt-1 [container-type:inline-size]">
        <ExplorerToggle fm={fm} showLabel />
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end [@container(width<9rem)]:grow">
          <input
            ref={importFilesInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={handleImportFilesChange}
          />
          <input
            ref={importFolderInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            // @ts-expect-error — non-standard directory picker attribute (Chromium, Firefox, Safari)
            webkitdirectory=""
            directory=""
            onChange={handleImportFolderChange}
          />
          <div className={EXPLORER_TOOL_PAIR_CLASS}>
            <ExplorerToolButton
              icon="file"
              label={t("modal.file_manager.context.new_file")}
              onClick={() => fm.createFile(importTargetPath(fm))}
            />
            <ExplorerToolButton
              icon="folder"
              label={t("modal.file_manager.context.new_folder")}
              onClick={() => fm.createFolder(importTargetPath(fm))}
            />
          </div>
          <div className={EXPLORER_TOOL_PAIR_CLASS}>
            <ExplorerToolButton
              icon="arrow-up"
              label={t("modal.file_manager.explorer.import_files")}
              onClick={openImportFilesPicker}
            />
            <ExplorerToolButton
              icon="archive"
              label={t("modal.file_manager.explorer.import_folder")}
              onClick={openImportFolderPicker}
            />
          </div>
          <div className={EXPLORER_TOOL_PAIR_CLASS}>
            <ExplorerToolButton
              icon="search"
              label={t(
                searchAtWork
                  ? "modal.file_manager.explorer.search_toggle_active"
                  : "modal.file_manager.explorer.search_toggle",
              )}
              pressed={searchOpen}
              active={searchAtWork}
              onClick={() => setSearchOpen(!searchOpen)}
            />
          </div>
        </div>
      </div>
      {searchOpen ? (
        <ExplorerSearch
          inputRef={searchInputRef}
          query={search}
          onQueryChange={(query) => fm.dispatch({ type: "set_explorer_search_query", query })}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      {fm.folderPresence?.get("/") === "none" ? (
        <p className="shrink-0 px-2 pb-1 text-[11px] leading-snug text-on-surface-variant">
          {t("modal.file_manager.explorer.folder_empty")}
        </p>
      ) : null}
      <nav
        className={[
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-1.5 pt-0",
          rootDropActive ? "ring-1 ring-inset ring-[var(--accent)]" : "",
        ].join(" ")}
        aria-label={t("modal.file_manager.explorer.title")}
        onContextMenu={handleNavContextMenu}
        onDragEnter={handleNavDragOver}
        onDragOver={handleNavDragOver}
        onDrop={handleNavDrop}
        aria-busy={fm.treeStatus === "loading" ? true : undefined}
      >
        {fm.treeStatus === "loading" ? (
          <FileTreeSkeleton label={t("modal.file_manager.explorer.loading")} />
        ) : fm.treeStatus === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2">
            <p className="text-xs text-on-surface-variant">
              {t("modal.file_manager.explorer.load_failed")}
            </p>
            <Button variant="ghost" size="sm" onClick={fm.retryTree}>
              {t("action.retry")}
            </Button>
          </div>
        ) : (
          <FileTreeRows fm={fm} search={deferredSearch} />
        )}
      </nav>
    </aside>
  );
}
