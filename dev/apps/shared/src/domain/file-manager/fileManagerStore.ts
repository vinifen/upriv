import {
  createEmptyFileManagerState,
  fileManagerReducer,
  type FileManagerAction,
  type FileManagerState,
  type FileManagerSurface,
} from "./dockReducer";

/**
 * File-manager sessions kept outside React state. Each reader subscribes to
 * the slice it draws, so a keystroke in one vault draws that vault's file
 * manager again and not the vault list, the dock, or another vault.
 */
export interface FileManagerStore {
  getState: () => FileManagerState;
  dispatch: (action: FileManagerAction) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createFileManagerStore(
  initial: FileManagerState = createEmptyFileManagerState(),
): FileManagerStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = fileManagerReducer(state, action);
      if (next === state) return;
      state = next;
      // A listener may unsubscribe while this runs (its component unmounted).
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One open file manager as the dock and the vault list show it: no workspace. */
export interface FileManagerShellEntry {
  vaultId: string;
  displayName: string;
  surface: FileManagerSurface;
  importInFlight: boolean;
}

export interface FileManagerShell {
  /** In dock order. */
  entries: readonly FileManagerShellEntry[];
  maximizedVaultId: string | null;
  focusedVaultId: string | null;
}

export function fileManagerShell(state: FileManagerState): FileManagerShell {
  const entries: FileManagerShellEntry[] = [];
  for (const vaultId of state.order) {
    const entry = state.entries[vaultId];
    if (!entry) continue;
    entries.push({
      vaultId,
      displayName: entry.displayName,
      surface: entry.surface,
      importInFlight: entry.importInFlight,
    });
  }
  return {
    entries,
    maximizedVaultId: state.maximizedVaultId,
    focusedVaultId: state.focusedVaultId,
  };
}

export function sameFileManagerShell(a: FileManagerShell, b: FileManagerShell): boolean {
  if (a.maximizedVaultId !== b.maximizedVaultId || a.focusedVaultId !== b.focusedVaultId) {
    return false;
  }
  if (a.entries.length !== b.entries.length) return false;
  return a.entries.every((entry, index) => {
    const other = b.entries[index];
    return (
      entry.vaultId === other.vaultId &&
      entry.displayName === other.displayName &&
      entry.surface === other.surface &&
      entry.importInFlight === other.importInFlight
    );
  });
}

/** The folder cue on a vault row: none, importing, or which surface is up. */
export type FileManagerIndicator = "importing" | FileManagerSurface | null;

export function fileManagerIndicator(
  state: FileManagerState,
  vaultId: string,
): FileManagerIndicator {
  const entry = state.entries[vaultId];
  if (!entry) return null;
  return entry.importInFlight ? "importing" : entry.surface;
}
