import type { UnsavedPromptAction, VaultWorkspaceState } from "./fileTreeTypes";

export type VaultWorkspaceAction =
  | { type: "toggle_folder"; path: string }
  | { type: "expand_folder"; path: string }
  | { type: "select_path"; path: string }
  | { type: "open_file"; path: string }
  | { type: "request_close_tab"; path: string }
  | { type: "close_tab"; path: string }
  | { type: "request_active_tab"; path: string }
  | { type: "set_active_tab"; path: string }
  | { type: "set_tree_split"; percent: number }
  | { type: "tree_mutated"; revision: number }
  | { type: "set_editor_draft"; path: string; content: string }
  | { type: "mark_saved"; path: string; content: string }
  | { type: "start_rename"; path: string }
  | { type: "cancel_rename" }
  | { type: "set_context_menu"; menu: VaultWorkspaceState["contextMenu"] }
  | { type: "set_delete_target"; target: VaultWorkspaceState["deleteTarget"] }
  | { type: "set_unsaved_prompt"; prompt: UnsavedPromptAction | null }
  | { type: "set_drag"; source: string | null; target: string | null }
  | { type: "set_toast"; message: string | null }
  | { type: "remap_paths"; map: Record<string, string> }
  | { type: "remove_paths"; paths: string[] }
  | { type: "discard_unsaved_and"; next: VaultWorkspaceAction };

function remapList(paths: string[], map: Record<string, string>): string[] {
  return paths.map((p) => map[p] ?? p).filter(Boolean);
}

function removeFromList(paths: string[], removeSet: Set<string>): string[] {
  return paths.filter((p) => !removeSet.has(p));
}

function applyPathMap(state: VaultWorkspaceState, map: Record<string, string>): VaultWorkspaceState {
  const openTabs = remapList(state.openTabs, map);
  const activeTabPath = state.activeTabPath ? map[state.activeTabPath] ?? state.activeTabPath : null;
  const selectedPath = state.selectedPath ? map[state.selectedPath] ?? state.selectedPath : null;
  const renamingPath = state.renamingPath ? map[state.renamingPath] ?? null : null;
  const expandedPaths = remapList(state.expandedPaths, map);
  const editorDrafts: Record<string, string> = {};
  const dirtyPaths: string[] = [];
  for (const [path, content] of Object.entries(state.editorDrafts)) {
    const next = map[path] ?? path;
    editorDrafts[next] = content;
    if (state.dirtyPaths.includes(path)) dirtyPaths.push(next);
  }
  return {
    ...state,
    openTabs,
    activeTabPath,
    selectedPath,
    renamingPath,
    expandedPaths,
    editorDrafts,
    dirtyPaths,
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
    selectedPath: state.selectedPath && removeSet.has(state.selectedPath) ? null : state.selectedPath,
    renamingPath: state.renamingPath && removeSet.has(state.renamingPath) ? null : state.renamingPath,
    editorDrafts,
    dirtyPaths: state.dirtyPaths.filter((p) => !removeSet.has(p)),
    expandedPaths: state.expandedPaths.filter((p) => !removeSet.has(p)),
  };
}

function needsUnsavedPrompt(state: VaultWorkspaceState, path: string | null): boolean {
  return Boolean(path && state.dirtyPaths.includes(path));
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
        selectedPath: action.path,
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
      return {
        ...state,
        openTabs,
        activeTabPath,
        dirtyPaths: state.dirtyPaths.filter((p) => p !== action.path),
        editorDrafts,
        unsavedPrompt: null,
      };
    }
    case "request_active_tab":
      return { ...state, activeTabPath: action.path, selectedPath: action.path, unsavedPrompt: null };
    case "set_active_tab":
      return vaultWorkspaceReducer(state, { type: "request_active_tab", path: action.path });
    case "set_tree_split":
      return { ...state, treeSplitPercent: action.percent };
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
      return {
        ...state,
        editorDrafts: { ...state.editorDrafts, [action.path]: action.content },
        dirtyPaths: state.dirtyPaths.filter((p) => p !== action.path),
      };
    }
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
    case "set_toast":
      return { ...state, toastMessage: action.message };
    case "remap_paths":
      return applyPathMap(state, action.map);
    case "remove_paths":
      return applyPathRemoval(state, action.paths);
    case "discard_unsaved_and": {
      const dirtyPath = state.unsavedPrompt?.path;
      const editorDrafts = { ...state.editorDrafts };
      if (dirtyPath) delete editorDrafts[dirtyPath];
      const next = {
        ...state,
        editorDrafts,
        dirtyPaths: state.dirtyPaths.filter((p) => p !== dirtyPath),
        unsavedPrompt: null,
      };
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
  return { type: "close_tab", path: prompt.path };
}
