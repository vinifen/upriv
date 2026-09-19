import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from "react";
import { Icon } from "@/components/icons";
import { useTranslation } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  findNode,
  getParentPath,
  isDescendantPath,
  isPathDirty,
  joinPath,
  liveFileNameError,
  fileNameErrorI18nKey,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  renameBasenameSelection,
  sessionPathKind,
} from "@upriv/shared";
import type { FileTreeNode } from "@upriv/shared";
import { filesFromDataTransfer, filesFromFileInput, isOsFileDrag } from "../lib/osFileDrop";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

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

function importTargetPath(fm: FileManagerApi): string {
  const selected = fm.workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(fm.tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}

function FileTreeRow({ node, path, depth, fm }: FileTreeRowProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const { workspace, dispatch, commitRename, movePath, importFiles } = fm;
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && workspace.expandedPaths.includes(path);
  const isSelected = workspace.activeTabPath === path;
  const isDirty = !isFolder && isPathDirty(workspace, path);
  const pathKind = sessionPathKind(workspace, path);
  const isRenaming = workspace.renamingPath === path;
  const isDragging = workspace.dragSourcePath === path;
  const isDropTarget = workspace.dropTargetPath === path && isFolder;
  const isRoot = path === "/";
  const longPressRef = useRef<number | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState(node.name);
  const renameError = isRenaming ? liveFileNameError(renameValue) : null;

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
    fm.openFile(path);
  };

  const handleContextMenu = (event: MouseEvent) => {
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
    if (event.pointerType !== "touch") return;
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
    if (isOsFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (workspace.dropTargetPath !== dropFolderPath) {
        dispatch({ type: "set_drag", source: null, target: dropFolderPath });
        if (dropFolderPath !== "/") dispatch({ type: "expand_folder", path: dropFolderPath });
      }
      return;
    }

    const source = workspace.dragSourcePath;
    if (!source || isDescendantPath(source, dropFolderPath)) {
      event.stopPropagation();
      if (source && workspace.dropTargetPath) {
        dispatch({ type: "set_drag", source, target: null });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (workspace.dropTargetPath !== dropFolderPath) {
      dispatch({ type: "set_drag", source, target: dropFolderPath });
      if (dropFolderPath !== "/") dispatch({ type: "expand_folder", path: dropFolderPath });
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (isOsFileDrag(event)) {
      void (async () => {
        try {
          const files = await filesFromDataTransfer(event);
          await importFiles(dropFolderPath, files);
        } catch (error) {
          showError(error, "error.unexpected");
        }
      })();
      dispatch({ type: "set_drag", source: null, target: null });
      return;
    }

    const from = workspace.dragSourcePath ?? event.dataTransfer.getData("text/plain");
    if (from && !isDescendantPath(from, dropFolderPath)) movePath(from, dropFolderPath);
    dispatch({ type: "set_drag", source: null, target: null });
  };

  const finishRename = (fromBlur = false) => {
    if (renameError) {
      if (fromBlur) dispatch({ type: "cancel_rename" });
      return;
    }
    commitRename(path, renameValue);
  };

  const row = (
    <div
      role={isRenaming ? undefined : "button"}
      tabIndex={isRenaming ? -1 : 0}
      draggable={!isRoot && !isRenaming}
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
      onDragOver={isFolder ? undefined : handleDragOver}
      onDrop={isFolder ? undefined : handleDrop}
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
          <span className="min-w-0 truncate">{node.name}</span>
          {isDirty ? (
            <span className="size-1.5 shrink-0 rounded-full bg-white" aria-hidden />
          ) : null}
        </span>
      )}
    </div>
  );

  if (!isFolder) return row;

  return (
    <div
      className={[
        "w-full min-w-0",
        isDropTarget ? "rounded-sm ring-1 ring-inset ring-[var(--accent)]" : "",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {row}
      {isExpanded
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
    </div>
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
  const { showError } = useErrorToast();
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
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
    if (event.target !== event.currentTarget) return;

    if (isOsFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (fm.workspace.dropTargetPath !== "/") {
        fm.dispatch({ type: "set_drag", source: null, target: "/" });
      }
      return;
    }

    const source = fm.workspace.dragSourcePath;
    if (!source || getParentPath(source) === "/") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (fm.workspace.dropTargetPath !== "/") {
      fm.dispatch({ type: "set_drag", source, target: "/" });
    }
  };

  const handleNavDrop = (event: DragEvent) => {
    if (event.target !== event.currentTarget) return;

    event.preventDefault();

    if (isOsFileDrag(event)) {
      void (async () => {
        try {
          const files = await filesFromDataTransfer(event);
          await fm.importFiles("/", files);
        } catch (error) {
          showError(error, "error.unexpected");
        }
      })();
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
      style={paneStyle}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-container"
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-2">
        <p
          className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-widest text-on-surface-variant"
          title={t("modal.file_manager.explorer.title")}
        >
          {t("modal.file_manager.explorer.title")}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
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
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            onClick={() => fm.createFile(importTargetPath(fm))}
            aria-label={t("modal.file_manager.context.new_file")}
            title={t("modal.file_manager.context.new_file")}
          >
            <Icon name="file" size={14} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            onClick={() => fm.createFolder(importTargetPath(fm))}
            aria-label={t("modal.file_manager.context.new_folder")}
            title={t("modal.file_manager.context.new_folder")}
          >
            <Icon name="folder" size={14} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            onClick={openImportFilesPicker}
            aria-label={t("modal.file_manager.explorer.import_files")}
            title={t("modal.file_manager.explorer.import_files")}
          >
            <Icon name="arrow-up" size={14} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            onClick={openImportFolderPicker}
            aria-label={t("modal.file_manager.explorer.import_folder")}
            title={t("modal.file_manager.explorer.import_folder")}
          >
            <Icon name="archive" size={14} />
          </button>
        </div>
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
