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
  /** Vault closed/deleted — tear down in-memory file session. */
  purgeForVaultClose: (vaultId: string) => void;
  /** Drop file-manager tabs for vaults that are gone or no longer open. */
  syncWithVaultList: (vaults: VaultListItem[]) => void;
  dispatchWorkspace: (vaultId: string, action: VaultWorkspaceAction) => void;
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

  const persistEntrySnapshot = useCallback(
    (vaultId: string) => {
      const entry = entriesRef.current[vaultId];
      if (!entry) return;
      persistWorkspaceSnapshot(fs, vaultId, entry.workspace);
    },
    [fs],
  );

  const openFromVault = useCallback(
    (vault: VaultListItem) => {
      const existing = entriesRef.current[vault.id];
      const workspace =
        existing?.workspace ?? loadPersistedWorkspaceState(fs, vault.id) ?? undefined;
      dispatch({ type: "open_from_vault", vault, workspace });
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
      persistEntrySnapshot(vaultId);
      fs.resetSession(vaultId);
      dispatch({ type: "purge_for_vault_close", vaultId });
    },
    [fs, persistEntrySnapshot],
  );

  const syncWithVaultList = useCallback(
    (vaults: VaultListItem[]) => {
      const openIds = new Set(
        vaults.filter((vault) => isVaultFileManagerRetained(vault)).map((vault) => vault.id),
      );
      const knownIds = new Set(vaults.map((vault) => vault.id));
      for (const vaultId of orderRef.current) {
        if (!knownIds.has(vaultId) || !openIds.has(vaultId)) {
          persistEntrySnapshot(vaultId);
          fs.resetSession(vaultId);
        }
      }
      dispatch({ type: "sync_with_vault_list", vaults });
    },
    [fs, persistEntrySnapshot],
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
