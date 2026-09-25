import { isVaultFileManagerEligible, isVaultFileManagerRetained, type VaultRow } from "../vault";
import { vaultWorkspaceReducer, type VaultWorkspaceAction } from "./workspaceReducer";
import {
  createDefaultWorkspaceState,
  hasUnsavedWorkspaceChanges,
  type UnsavedPromptAction,
  type VaultWorkspaceState,
} from "./workspaceTypes";

export type FileManagerSurface = "maximized" | "minimized";

export interface FileManagerEntry {
  vaultId: string;
  displayName: string;
  surface: FileManagerSurface;
  workspace: VaultWorkspaceState;
  /** True while an OS/in-app import session is still writing. RAM-only. */
  importInFlight: boolean;
}

export interface FileManagerState {
  entries: Record<string, FileManagerEntry>;
  order: string[];
  maximizedVaultId: string | null;
  /** Last vault the user opened or brought to front — used for dock highlight when minimized. */
  focusedVaultId: string | null;
}

export type FileManagerAction =
  | { type: "open_from_vault"; vault: VaultRow; workspace?: VaultWorkspaceState }
  | { type: "minimize"; vaultId: string }
  | { type: "maximize"; vaultId: string }
  | { type: "dismiss"; vaultId: string }
  | { type: "purge_for_vault_close"; vaultId: string }
  | { type: "sync_with_vault_list"; vaults: readonly VaultRow[] }
  | { type: "workspace"; vaultId: string; action: VaultWorkspaceAction }
  | { type: "set_import_in_flight"; vaultId: string; inFlight: boolean };

export type FileManagerDismissIntent = "import_in_progress" | "unsaved" | "dismiss";

export function fileManagerDismissIntent(
  entry: Pick<FileManagerEntry, "importInFlight" | "workspace">,
): FileManagerDismissIntent {
  if (entry.importInFlight) return "import_in_progress";
  if (hasUnsavedWorkspaceChanges(entry.workspace)) return "unsaved";
  return "dismiss";
}

export function fileManagerBlockingPrompt(
  intent: FileManagerDismissIntent,
): UnsavedPromptAction | null {
  if (intent === "import_in_progress") return { type: "import_in_progress" };
  if (intent === "unsaved") return { type: "dismiss_workspace" };
  return null;
}

export function createEmptyFileManagerState(): FileManagerState {
  return {
    entries: {},
    order: [],
    maximizedVaultId: null,
    focusedVaultId: null,
  };
}

function removeEntry(state: FileManagerState, vaultId: string): FileManagerState {
  if (!state.entries[vaultId]) return state;
  const nextEntries = { ...state.entries };
  delete nextEntries[vaultId];
  return {
    entries: nextEntries,
    order: state.order.filter((id) => id !== vaultId),
    maximizedVaultId: state.maximizedVaultId === vaultId ? null : state.maximizedVaultId,
    focusedVaultId: state.focusedVaultId === vaultId ? null : state.focusedVaultId,
  };
}

function minimizeEntry(state: FileManagerState, vaultId: string): FileManagerState {
  const existing = state.entries[vaultId];
  if (!existing) return state;
  return {
    ...state,
    entries: {
      ...state.entries,
      [vaultId]: {
        ...existing,
        surface: "minimized",
        workspace: { ...existing.workspace, unsavedPrompt: null },
      },
    },
    maximizedVaultId: state.maximizedVaultId === vaultId ? null : state.maximizedVaultId,
  };
}

export function fileManagerReducer(
  state: FileManagerState,
  action: FileManagerAction,
): FileManagerState {
  switch (action.type) {
    case "open_from_vault": {
      if (!isVaultFileManagerEligible(action.vault)) return state;

      let next = state;
      if (state.maximizedVaultId && state.maximizedVaultId !== action.vault.id) {
        next = minimizeEntry(next, state.maximizedVaultId);
      }

      const existing = next.entries[action.vault.id];
      const entry: FileManagerEntry = {
        vaultId: action.vault.id,
        displayName: action.vault.displayName,
        surface: "maximized",
        workspace: existing?.workspace ?? action.workspace ?? createDefaultWorkspaceState(),
        importInFlight: existing?.importInFlight ?? false,
      };

      return {
        entries: { ...next.entries, [action.vault.id]: entry },
        order: next.order.includes(action.vault.id) ? next.order : [...next.order, action.vault.id],
        maximizedVaultId: action.vault.id,
        focusedVaultId: action.vault.id,
      };
    }
    case "minimize":
      return minimizeEntry(state, action.vaultId);
    case "maximize": {
      if (!state.entries[action.vaultId]) return state;
      if (state.maximizedVaultId === action.vaultId) return state;

      let next = state;
      if (state.maximizedVaultId) {
        next = minimizeEntry(next, state.maximizedVaultId);
      }

      const target = next.entries[action.vaultId];
      return {
        ...next,
        entries: { ...next.entries, [action.vaultId]: { ...target, surface: "maximized" } },
        maximizedVaultId: action.vaultId,
        focusedVaultId: action.vaultId,
      };
    }
    case "dismiss":
      return removeEntry(state, action.vaultId);
    case "purge_for_vault_close":
      return removeEntry(state, action.vaultId);
    case "sync_with_vault_list": {
      const openIds = new Set(
        action.vaults.filter((vault) => isVaultFileManagerRetained(vault)).map((vault) => vault.id),
      );
      const knownIds = new Set(action.vaults.map((vault) => vault.id));
      let next = state;
      for (const vaultId of state.order) {
        if (!knownIds.has(vaultId) || !openIds.has(vaultId)) {
          next = removeEntry(next, vaultId);
        }
      }
      return next;
    }
    case "workspace": {
      const existing = state.entries[action.vaultId];
      if (!existing) return state;
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.vaultId]: {
            ...existing,
            workspace: vaultWorkspaceReducer(existing.workspace, action.action),
          },
        },
      };
    }
    case "set_import_in_flight": {
      const existing = state.entries[action.vaultId];
      if (!existing || existing.importInFlight === action.inFlight) return state;
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.vaultId]: { ...existing, importInFlight: action.inFlight },
        },
      };
    }
    default:
      return state;
  }
}
