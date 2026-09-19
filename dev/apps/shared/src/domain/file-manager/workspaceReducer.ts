import type { UnsavedPromptAction, VaultWorkspaceState } from "./workspaceTypes";
import { ancestorFolderPaths, remapLogicalPath } from "../file-tree/treeOps";

export type { UnsavedPromptAction, VaultWorkspaceState } from "./workspaceTypes";
export {
  createDefaultWorkspaceState,
  hasUnsavedWorkspaceChanges,
  isPathDirty,
  isPathSessionModified,
  sessionPathKind,
  type SessionPathKind,
} from "./workspaceTypes";

export type VaultWorkspaceAction =
  | { type: "toggle_folder"; path: string }
  | { type: "expand_folder"; path: string }
  | { type: "select_path"; path: string }
  | { type: "open_file"; path: string }
  | { type: "request_close_tab"; path: string }
  | { type: "close_tab"; path: string }
  | { type: "request_active_tab"; path: string }
  | { type: "set_active_tab"; path: string }
  | { type: "reorder_tabs"; fromPath: string; toPath: string }
  | {
      type: "hydrate_persisted";
      openTabs: string[];
      activeTabPath: string | null;
      expandedPaths: string[];
      selectedPath: string | null;
    }
  | { type: "tree_mutated"; revision: number }
  | { type: "set_editor_draft"; path: string; content: string }
  | { type: "mark_saved"; path: string; content: string }
  | { type: "mark_session_created"; paths: string[] }
  | { type: "start_rename"; path: string }
  | { type: "cancel_rename" }
  | { type: "set_context_menu"; menu: VaultWorkspaceState["contextMenu"] }
  | { type: "set_delete_target"; target: VaultWorkspaceState["deleteTarget"] }
  | { type: "set_unsaved_prompt"; prompt: UnsavedPromptAction | null }
  | { type: "set_drag"; source: string | null; target: string | null }
  | { type: "remap_paths"; map: Record<string, string> }
  | { type: "remove_paths"; paths: string[] }
  | { type: "discard_unsaved_and"; next: VaultWorkspaceAction };

function mergeUniquePaths(existing: readonly string[], added: readonly string[]): string[] {
  if (added.length === 0) return existing.slice();
  const next = existing.slice();
  for (const path of added) {
    if (path && !next.includes(path)) next.push(path);
  }
  return next;
}

function remapPath(path: string, map: Record<string, string>): string {
  const froms = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const from of froms) {
    const to = map[from];
    if (!to) continue;
    const next = remapLogicalPath(path, from, to);
    if (next !== path) return next;
  }
  return path;
}

function remapList(paths: string[], map: Record<string, string>): string[] {
  return mergeUniquePaths([], paths.map((p) => remapPath(p, map)).filter(Boolean));
}

function removeFromList(paths: string[], removeSet: Set<string>): string[] {
  return paths.filter((p) => !removeSet.has(p));
}

/** Move `fromPath` to the index of `toPath` in the open-tabs strip. */
export function reorderOpenTabs(
  tabs: readonly string[],
  fromPath: string,
  toPath: string,
): string[] | null {
  if (fromPath === toPath) return null;
  const from = tabs.indexOf(fromPath);
  const to = tabs.indexOf(toPath);
  if (from < 0 || to < 0) return null;
  const next = tabs.slice();
  next.splice(from, 1);
  next.splice(to, 0, fromPath);
  if (next.length === tabs.length && next.every((path, index) => path === tabs[index])) {
    return null;
  }
  return next;
}

function applyPathMap(
  state: VaultWorkspaceState,
  map: Record<string, string>,
): VaultWorkspaceState {
  const openTabs = remapList(state.openTabs, map);
  const activeTabPath = state.activeTabPath ? remapPath(state.activeTabPath, map) : null;
  const selectedPath = state.selectedPath ? remapPath(state.selectedPath, map) : null;
  const renamingPath = state.renamingPath ? remapPath(state.renamingPath, map) : null;
  const expandedPaths = remapList(state.expandedPaths, map);
  const editorDrafts: Record<string, string> = {};
  for (const [path, content] of Object.entries(state.editorDrafts)) {
    editorDrafts[remapPath(path, map)] = content;
  }
  const dirtyPaths = remapList(state.dirtyPaths, map);

  const remappedCreated = remapList(state.sessionCreatedPaths, map);
  const remappedModified = remapList(state.sessionModifiedPaths, map);
  /* Rename/move of a previously clean path counts as modified at the destination. */
  const destinations = Object.values(map);
  const createdSet = new Set(remappedCreated);
  const modifiedExtra = destinations.filter((p) => p && !createdSet.has(p));

  return {
    ...state,
    openTabs,
    activeTabPath,
    selectedPath,
    renamingPath,
    expandedPaths,
    editorDrafts,
    dirtyPaths,
    sessionCreatedPaths: remappedCreated,
    sessionModifiedPaths: mergeUniquePaths(remappedModified, modifiedExtra),
  };
}

function applyPathRemoval(state: VaultWorkspaceState, paths: string[]): VaultWorkspaceState {
  const removeSet = new Set(paths);
  const openTabs = removeFromList(state.openTabs, removeSet);
  let activeTabPath = state.activeTabPath;
  if (activeTabPath && removeSet.has(activeTabPath)) {
    const closedIndex = state.openTabs.indexOf(activeTabPath);
    activeTabPath = openTabs[closedIndex] ?? openTabs[closedIndex - 1] ?? null;
  }
  const editorDrafts = { ...state.editorDrafts };
  for (const path of paths) delete editorDrafts[path];
  return {
    ...state,
    openTabs,
    activeTabPath,
    selectedPath:
      state.selectedPath && removeSet.has(state.selectedPath) ? null : state.selectedPath,
    renamingPath:
      state.renamingPath && removeSet.has(state.renamingPath) ? null : state.renamingPath,
    editorDrafts,
    dirtyPaths: state.dirtyPaths.filter((p) => !removeSet.has(p)),
    sessionCreatedPaths: state.sessionCreatedPaths.filter((p) => !removeSet.has(p)),
    sessionModifiedPaths: state.sessionModifiedPaths.filter((p) => !removeSet.has(p)),
    expandedPaths: state.expandedPaths.filter((p) => !removeSet.has(p)),
  };
}

function needsUnsavedPrompt(state: VaultWorkspaceState, path: string | null): boolean {
  return Boolean(path && state.dirtyPaths.includes(path));
}

function activateTab(state: VaultWorkspaceState, path: string): VaultWorkspaceState {
  const expandedPaths = mergeExpanded(state.expandedPaths, ancestorFolderPaths(path));
  return {
    ...state,
    activeTabPath: path,
    selectedPath: path,
    expandedPaths,
    unsavedPrompt: null,
  };
}

function mergeExpanded(existing: readonly string[], add: readonly string[]): string[] {
  const next = existing.slice();
  for (const path of add) {
    if (path && !next.includes(path)) next.push(path);
  }
  return next;
}

function discardDirtyPaths(
  state: VaultWorkspaceState,
  paths: readonly string[],
): VaultWorkspaceState {
  const removeSet = new Set(paths);
  const editorDrafts = { ...state.editorDrafts };
  for (const path of paths) delete editorDrafts[path];
  return {
    ...state,
    editorDrafts,
    dirtyPaths: state.dirtyPaths.filter((p) => !removeSet.has(p)),
    unsavedPrompt: null,
  };
}

export function vaultWorkspaceReducer(
  state: VaultWorkspaceState,
  action: VaultWorkspaceAction,
): VaultWorkspaceState {
  switch (action.type) {
    case "toggle_folder": {
      const expanded = state.expandedPaths.includes(action.path);
      return {
        ...state,
        expandedPaths: expanded
          ? state.expandedPaths.filter((p) => p !== action.path)
          : [...state.expandedPaths, action.path],
      };
    }
    case "expand_folder":
      return state.expandedPaths.includes(action.path)
        ? state
        : { ...state, expandedPaths: [...state.expandedPaths, action.path] };
    case "select_path":
      return { ...state, selectedPath: action.path };
    case "open_file": {
      const openTabs = state.openTabs.includes(action.path)
        ? state.openTabs
        : [...state.openTabs, action.path];
      return {
        ...state,
        openTabs,
        activeTabPath: action.path,
        selectedPath: action.path,
        expandedPaths: mergeExpanded(state.expandedPaths, ancestorFolderPaths(action.path)),
        unsavedPrompt: null,
      };
    }
    case "request_close_tab":
      if (needsUnsavedPrompt(state, action.path)) {
        return { ...state, unsavedPrompt: { type: "close_tab", path: action.path } };
      }
      return vaultWorkspaceReducer(state, { type: "close_tab", path: action.path });
    case "close_tab": {
      const openTabs = state.openTabs.filter((p) => p !== action.path);
      let activeTabPath = state.activeTabPath;
      if (activeTabPath === action.path) {
        const closedIndex = state.openTabs.indexOf(action.path);
        const nextTab = openTabs[closedIndex] ?? openTabs[closedIndex - 1] ?? null;
        activeTabPath = nextTab;
      }
      const editorDrafts = { ...state.editorDrafts };
      delete editorDrafts[action.path];
      const selectedPath = state.selectedPath === action.path ? activeTabPath : state.selectedPath;
      return {
        ...state,
        openTabs,
        activeTabPath,
        selectedPath,
        dirtyPaths: state.dirtyPaths.filter((p) => p !== action.path),
        editorDrafts,
        unsavedPrompt: null,
      };
    }
    case "request_active_tab": {
      if (action.path === state.activeTabPath) return state;
      /* VS Code-style: dirty drafts stay in RAM; switching tabs never prompts. */
      return activateTab(state, action.path);
    }
    case "set_active_tab":
      return vaultWorkspaceReducer(state, { type: "request_active_tab", path: action.path });
    case "reorder_tabs": {
      const openTabs = reorderOpenTabs(state.openTabs, action.fromPath, action.toPath);
      if (!openTabs) return state;
      return { ...state, openTabs };
    }
    case "hydrate_persisted":
      return {
        ...state,
        openTabs: action.openTabs,
        activeTabPath: action.activeTabPath,
        expandedPaths: action.expandedPaths.length > 0 ? action.expandedPaths : ["/"],
        selectedPath: action.selectedPath,
      };
    case "tree_mutated":
      return { ...state, treeRevision: action.revision };
    case "set_editor_draft": {
      const dirtyPaths = state.dirtyPaths.includes(action.path)
        ? state.dirtyPaths
        : [...state.dirtyPaths, action.path];
      return {
        ...state,
        editorDrafts: { ...state.editorDrafts, [action.path]: action.content },
        dirtyPaths,
      };
    }
    case "mark_saved": {
      const isCreated = state.sessionCreatedPaths.includes(action.path);
      return {
        ...state,
        editorDrafts: { ...state.editorDrafts, [action.path]: action.content },
        dirtyPaths: state.dirtyPaths.filter((p) => p !== action.path),
        /* Created stays green; only mark modified when the path was not new this session. */
        sessionModifiedPaths: isCreated
          ? state.sessionModifiedPaths
          : mergeUniquePaths(state.sessionModifiedPaths, [action.path]),
      };
    }
    case "mark_session_created":
      return {
        ...state,
        sessionCreatedPaths: mergeUniquePaths(state.sessionCreatedPaths, action.paths),
        /* Drop from modified if somehow present — created wins. */
        sessionModifiedPaths: state.sessionModifiedPaths.filter((p) => !action.paths.includes(p)),
      };
    case "start_rename":
      return { ...state, renamingPath: action.path, contextMenu: null };
    case "cancel_rename":
      return { ...state, renamingPath: null };
    case "set_context_menu":
      return { ...state, contextMenu: action.menu };
    case "set_delete_target":
      return { ...state, deleteTarget: action.target, contextMenu: null };
    case "set_unsaved_prompt":
      return { ...state, unsavedPrompt: action.prompt };
    case "set_drag":
      return { ...state, dragSourcePath: action.source, dropTargetPath: action.target };
    case "remap_paths":
      return applyPathMap(state, action.map);
    case "remove_paths":
      return applyPathRemoval(state, action.paths);
    case "discard_unsaved_and": {
      const dirtyPath = state.unsavedPrompt?.type === "close_tab" ? state.unsavedPrompt.path : null;
      const dirtyPaths =
        state.unsavedPrompt?.type === "dismiss_workspace"
          ? state.dirtyPaths
          : dirtyPath
            ? [dirtyPath]
            : [];
      const next = discardDirtyPaths(state, dirtyPaths);
      return vaultWorkspaceReducer(next, action.next);
    }
    default:
      return state;
  }
}

export function resolveUnsavedPrompt(
  _state: VaultWorkspaceState,
  prompt: UnsavedPromptAction,
): VaultWorkspaceAction {
  switch (prompt.type) {
    case "close_tab":
      return { type: "close_tab", path: prompt.path };
    case "dismiss_workspace":
      return { type: "set_unsaved_prompt", prompt: null };
  }
}
