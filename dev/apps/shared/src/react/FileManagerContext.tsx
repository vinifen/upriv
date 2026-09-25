import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  createEmptyFileManagerState,
  fileManagerReducer,
  persistWorkspaceSnapshot,
  isVaultFileManagerRetained,
  type FileManagerEntry,
  type VaultFileSystemService,
  type VaultListItem,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { loadPersistedWorkspaceState } from "./useWorkspacePersistence";

export interface FileManagerContextValue {
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
  /** Flush layout into the open session. Await this before `vault_close`. */
  flushWorkspaceSnapshot: (vaultId: string) => Promise<void>;
  /** Vault closed/deleted — tear down in-memory file session (do not write). */
  purgeForVaultClose: (vaultId: string) => void;
  /** Drop file-manager tabs for vaults that are gone or no longer open. */
  syncWithVaultList: (vaults: VaultListItem[]) => void;
  dispatchWorkspace: (vaultId: string, action: VaultWorkspaceAction) => void;
  setImportInFlight: (vaultId: string, inFlight: boolean) => void;
}

const FileManagerContext = createContext<FileManagerContextValue | null>(null);

export function FileManagerProvider({
  fs,
  children,
}: {
  fs: VaultFileSystemService;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(fileManagerReducer, createEmptyFileManagerState());
  const orderRef = useRef(state.order);
  const entriesRef = useRef(state.entries);

  useEffect(() => {
    orderRef.current = state.order;
  }, [state.order]);

  useEffect(() => {
    entriesRef.current = state.entries;
  }, [state.entries]);

  const loadGenByVault = useRef<Record<string, number>>({});

  const bumpLoadGen = (vaultId: string): number => {
    const next = (loadGenByVault.current[vaultId] ?? 0) + 1;
    loadGenByVault.current[vaultId] = next;
    return next;
  };

  const persistEntrySnapshot = useCallback(
    (vaultId: string) => {
      const entry = entriesRef.current[vaultId];
      if (!entry) return;
      void persistWorkspaceSnapshot(fs, vaultId, entry.workspace);
    },
    [fs],
  );

  const flushWorkspaceSnapshot = useCallback(
    async (vaultId: string) => {
      const entry = entriesRef.current[vaultId];
      if (!entry) return;
      try {
        await persistWorkspaceSnapshot(fs, vaultId, entry.workspace);
      } catch {
        // Close must still run. Layout is also written on each edit while open.
      }
    },
    [fs],
  );

  const openFromVault = useCallback(
    (vault: VaultListItem) => {
      const existing = entriesRef.current[vault.id];
      if (existing?.workspace) {
        bumpLoadGen(vault.id);
        dispatch({ type: "open_from_vault", vault, workspace: existing.workspace });
        return;
      }
      const gen = bumpLoadGen(vault.id);
      void loadPersistedWorkspaceState(fs, vault.id)
        .then((workspace) => {
          if (loadGenByVault.current[vault.id] !== gen) return;
          dispatch({ type: "open_from_vault", vault, workspace: workspace ?? undefined });
        })
        .catch(() => {
          if (loadGenByVault.current[vault.id] !== gen) return;
          dispatch({ type: "open_from_vault", vault });
        });
    },
    [fs],
  );

  const minimize = useCallback((vaultId: string) => {
    dispatch({ type: "minimize", vaultId });
  }, []);

  const maximize = useCallback((vaultId: string) => {
    dispatch({ type: "maximize", vaultId });
  }, []);

  const dismiss = useCallback(
    (vaultId: string) => {
      persistEntrySnapshot(vaultId);
      dispatch({ type: "dismiss", vaultId });
    },
    [persistEntrySnapshot],
  );

  const purgeForVaultClose = useCallback(
    (vaultId: string) => {
      bumpLoadGen(vaultId);
      fs.resetSession(vaultId);
      dispatch({ type: "purge_for_vault_close", vaultId });
    },
    [fs],
  );

  const syncWithVaultList = useCallback(
    (vaults: VaultListItem[]) => {
      const openIds = new Set(
        vaults.filter((vault) => isVaultFileManagerRetained(vault)).map((vault) => vault.id),
      );
      const knownIds = new Set(vaults.map((vault) => vault.id));
      for (const vaultId of orderRef.current) {
        if (!knownIds.has(vaultId) || !openIds.has(vaultId)) {
          bumpLoadGen(vaultId);
          fs.resetSession(vaultId);
        }
      }
      dispatch({ type: "sync_with_vault_list", vaults });
    },
    [fs],
  );

  const dispatchWorkspace = useCallback(
    (vaultId: string, workspaceAction: VaultWorkspaceAction) => {
      dispatch({ type: "workspace", vaultId, action: workspaceAction });
    },
    [],
  );

  const setImportInFlight = useCallback((vaultId: string, inFlight: boolean) => {
    dispatch({ type: "set_import_in_flight", vaultId, inFlight });
  }, []);

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
      flushWorkspaceSnapshot,
      purgeForVaultClose,
      syncWithVaultList,
      dispatchWorkspace,
      setImportInFlight,
    };
  }, [
    state,
    openFromVault,
    minimize,
    maximize,
    dismiss,
    flushWorkspaceSnapshot,
    purgeForVaultClose,
    syncWithVaultList,
    dispatchWorkspace,
    setImportInFlight,
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
