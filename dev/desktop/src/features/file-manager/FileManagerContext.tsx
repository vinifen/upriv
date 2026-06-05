import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { resolveVaultDisplayStatus } from "@/types";
import type { VaultListItem } from "@/features/vault-list/types";
import { createDefaultWorkspaceState } from "./fileTreeTypes";
import { resetVaultFileSession } from "./mockVaultFileSystem";
import type { FileManagerEntry } from "./fileManagerTypes";
import { vaultWorkspaceReducer, type VaultWorkspaceAction } from "./vaultWorkspaceReducer";

interface FileManagerState {
  entries: Record<string, FileManagerEntry>;
  order: string[];
  maximizedVaultId: string | null;
}

type FileManagerAction =
  | { type: "open_from_vault"; vault: VaultListItem }
  | { type: "minimize"; vaultId: string }
  | { type: "maximize"; vaultId: string }
  | { type: "close"; vaultId: string }
  | { type: "workspace"; vaultId: string; action: VaultWorkspaceAction };

interface FileManagerContextValue {
  entries: Record<string, FileManagerEntry>;
  entryOrder: readonly string[];
  maximizedVaultId: string | null;
  maximizedEntry: FileManagerEntry | null;
  minimizedEntries: FileManagerEntry[];
  openFromVault: (vault: VaultListItem) => void;
  minimize: (vaultId: string) => void;
  maximize: (vaultId: string) => void;
  close: (vaultId: string) => void;
  dispatchWorkspace: (vaultId: string, action: VaultWorkspaceAction) => void;
}

const FileManagerContext = createContext<FileManagerContextValue | null>(null);

const initialState: FileManagerState = {
  entries: {},
  order: [],
  maximizedVaultId: null,
};

function minimizeEntry(
  state: FileManagerState,
  vaultId: string,
): FileManagerState {
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
      };
    }
    case "close": {
      if (!state.entries[action.vaultId]) return state;
      resetVaultFileSession(action.vaultId);
      const nextEntries = { ...state.entries };
      delete nextEntries[action.vaultId];
      return {
        entries: nextEntries,
        order: state.order.filter((id) => id !== action.vaultId),
        maximizedVaultId: state.maximizedVaultId === action.vaultId ? null : state.maximizedVaultId,
      };
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

  const close = useCallback((vaultId: string) => {
    dispatch({ type: "close", vaultId });
  }, []);

  const dispatchWorkspace = useCallback((vaultId: string, workspaceAction: VaultWorkspaceAction) => {
    dispatch({ type: "workspace", vaultId, action: workspaceAction });
  }, []);

  const value = useMemo(() => {
    const maximizedEntry = state.maximizedVaultId ? state.entries[state.maximizedVaultId] ?? null : null;
    const minimizedEntries = state.order
      .map((id) => state.entries[id])
      .filter((entry): entry is FileManagerEntry => Boolean(entry && entry.surface === "minimized"));

    return {
      entries: state.entries,
      entryOrder: state.order,
      maximizedVaultId: state.maximizedVaultId,
      maximizedEntry,
      minimizedEntries,
      openFromVault,
      minimize,
      maximize,
      close,
      dispatchWorkspace,
    };
  }, [state, openFromVault, minimize, maximize, close, dispatchWorkspace]);

  return <FileManagerContext.Provider value={value}>{children}</FileManagerContext.Provider>;
}

export function useFileManager(): FileManagerContextValue {
  const ctx = useContext(FileManagerContext);
  if (!ctx) {
    throw new Error("useFileManager must be used within FileManagerProvider");
  }
  return ctx;
}
