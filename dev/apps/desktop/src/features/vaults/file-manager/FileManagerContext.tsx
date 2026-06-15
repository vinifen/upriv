import {
createContext,
useCallback,
useContext,
useMemo,
useReducer,
type ReactNode
} from "react";
import { useVaultFileSystemService } from "@/platform/services";
import { resolveVaultDisplayStatus, type VaultListItem } from "@upriv/shared";
import { createDefaultWorkspaceState } from "./fileTreeTypes";
import type { FileManagerEntry } from "./fileManagerTypes";
import { vaultWorkspaceReducer, type VaultWorkspaceAction } from "./vaultWorkspaceReducer";

interface FileManagerState {
  entries: Record<string, FileManagerEntry>;
  order: string[];
  maximizedVaultId: string | null;
  /** Last vault the user opened or brought to front — used for dock highlight when minimized. */
  focusedVaultId: string | null;
}

type FileManagerAction =
  | { type: "open_from_vault"; vault: VaultListItem }
  | { type: "minimize"; vaultId: string }
  | { type: "maximize"; vaultId: string }
  | { type: "dismiss"; vaultId: string }
  | { type: "purge_for_vault_close"; vaultId: string }
  | { type: "sync_with_vault_list"; vaults: VaultListItem[] }
  | { type: "workspace"; vaultId: string; action: VaultWorkspaceAction };

interface FileManagerContextValue {
  entries: Record<string, FileManagerEntry>;
  entryOrder: readonly string[];
  maximizedVaultId: string | null;
  focusedVaultId: string | null;
  maximizedEntry: FileManagerEntry | null;
  minimizedEntries: FileManagerEntry[];
  openFromVault: (vault: VaultListItem) => void;
  minimize: (vaultId: string) => void;
  maximize: (vaultId: string) => void;
  /** Hide file-manager UI; vault stays open on the list. */
  dismiss: (vaultId: string) => void;
  /** Vault closed/sealed/deleted — tear down in-memory file session. */
  purgeForVaultClose: (vaultId: string) => void;
  /** Drop file-manager tabs for vaults that are gone or no longer open. */
  syncWithVaultList: (vaults: VaultListItem[]) => void;
  dispatchWorkspace: (vaultId: string, action: VaultWorkspaceAction) => void;
}

const FileManagerContext = createContext<FileManagerContextValue | null>(null);

const initialState: FileManagerState = {
  entries: {},
  order: [],
  maximizedVaultId: null,
  focusedVaultId: null,
};

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
    entries: { ...state.entries, [vaultId]: { ...existing, surface: "minimized" } },
    maximizedVaultId: state.maximizedVaultId === vaultId ? null : state.maximizedVaultId,
  };
}

function fileManagerReducer(state: FileManagerState, action: FileManagerAction): FileManagerState {
  switch (action.type) {
    case "open_from_vault": {
      if (resolveVaultDisplayStatus(action.vault) !== "open") return state;

      let next = state;
      if (state.maximizedVaultId && state.maximizedVaultId !== action.vault.id) {
        next = minimizeEntry(next, state.maximizedVaultId);
      }

      const existing = next.entries[action.vault.id];
      const entry: FileManagerEntry = {
        vaultId: action.vault.id,
        displayName: action.vault.displayName,
        surface: "maximized",
        workspace: existing?.workspace ?? createDefaultWorkspaceState(),
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
        action.vaults.filter((vault) => vault.session === "open").map((vault) => vault.id),
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
    default:
      return state;
  }
}

export function FileManagerProvider({ children }: { children: ReactNode }) {
  const fs = useVaultFileSystemService();
  const [state, dispatch] = useReducer(fileManagerReducer, initialState);

  const openFromVault = useCallback((vault: VaultListItem) => {
    dispatch({ type: "open_from_vault", vault });
  }, []);

  const minimize = useCallback((vaultId: string) => {
    dispatch({ type: "minimize", vaultId });
  }, []);

  const maximize = useCallback((vaultId: string) => {
    dispatch({ type: "maximize", vaultId });
  }, []);

  const dismiss = useCallback((vaultId: string) => {
    dispatch({ type: "dismiss", vaultId });
  }, []);

  const purgeForVaultClose = useCallback(
    (vaultId: string) => {
      fs.resetSession(vaultId);
      dispatch({ type: "purge_for_vault_close", vaultId });
    },
    [fs],
  );

  const syncWithVaultList = useCallback(
    (vaults: VaultListItem[]) => {
      const openIds = new Set(
        vaults.filter((vault) => vault.session === "open").map((vault) => vault.id),
      );
      const knownIds = new Set(vaults.map((vault) => vault.id));
      for (const vaultId of state.order) {
        if (!knownIds.has(vaultId) || !openIds.has(vaultId)) {
          fs.resetSession(vaultId);
        }
      }
      dispatch({ type: "sync_with_vault_list", vaults });
    },
    [fs, state.order],
  );

  const dispatchWorkspace = useCallback(
    (vaultId: string, workspaceAction: VaultWorkspaceAction) => {
      dispatch({ type: "workspace", vaultId, action: workspaceAction });
    },
    [],
  );

  const value = useMemo(() => {
    const maximizedEntry = state.maximizedVaultId
      ? (state.entries[state.maximizedVaultId] ?? null)
      : null;
    const minimizedEntries = state.order
      .map((id) => state.entries[id])
      .filter((entry): entry is FileManagerEntry =>
        Boolean(entry && entry.surface === "minimized"),
      );

    return {
      entries: state.entries,
      entryOrder: state.order,
      maximizedVaultId: state.maximizedVaultId,
      focusedVaultId: state.focusedVaultId,
      maximizedEntry,
      minimizedEntries,
      openFromVault,
      minimize,
      maximize,
      dismiss,
      purgeForVaultClose,
      syncWithVaultList,
      dispatchWorkspace,
    };
  }, [
    state,
    openFromVault,
    minimize,
    maximize,
    dismiss,
    purgeForVaultClose,
    syncWithVaultList,
    dispatchWorkspace,
  ]);

  return <FileManagerContext.Provider value={value}>{children}</FileManagerContext.Provider>;
}

export function useFileManager(): FileManagerContextValue {
  const ctx = useContext(FileManagerContext);
  if (!ctx) {
    throw new Error("useFileManager must be used within FileManagerProvider");
  }
  return ctx;
}
