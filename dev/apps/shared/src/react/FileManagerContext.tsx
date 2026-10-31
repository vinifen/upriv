import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createFileManagerStore,
  fileManagerShell,
  isVaultFileManagerRetained,
  persistWorkspaceSnapshot,
  sameFileManagerShell,
  type FileManagerEntry,
  type FileManagerShell,
  type FileManagerState,
  type VaultFileSystemService,
  type VaultListItem,
  type VaultWorkspaceAction,
} from "@upriv/shared";

/**
 * File-manager sessions and their actions. The object never changes, so
 * holding it does not draw again: read state with {@link useFileManagerSelector}
 * (or the hooks built on it) or, inside a handler, with `getEntry`.
 */
export interface FileManagerController {
  getState: () => FileManagerState;
  /** The entry as it is now, including a dispatch made since the last render. */
  getEntry: (vaultId: string) => FileManagerEntry | null;
  subscribe: (listener: () => void) => () => void;
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

const FileManagerContext = createContext<FileManagerController | null>(null);

export function FileManagerProvider({
  fs,
  children,
}: {
  fs: VaultFileSystemService;
  children: ReactNode;
}) {
  const [store] = useState(() => createFileManagerStore());

  const controller = useMemo<FileManagerController>(() => {
    const getEntry = (vaultId: string) => store.getState().entries[vaultId] ?? null;
    return {
      getState: store.getState,
      getEntry,
      subscribe: store.subscribe,
      // Show the shell now. Layout hydration reads the vault file after paint.
      openFromVault: (vault) => store.dispatch({ type: "open_from_vault", vault }),
      minimize: (vaultId) => store.dispatch({ type: "minimize", vaultId }),
      maximize: (vaultId) => store.dispatch({ type: "maximize", vaultId }),
      dismiss(vaultId) {
        const entry = getEntry(vaultId);
        if (entry) {
          void persistWorkspaceSnapshot(fs, vaultId, entry.workspace).catch(() => {
            /* Best-effort: the workspace also writes its layout as it unmounts. */
          });
        }
        store.dispatch({ type: "dismiss", vaultId });
      },
      async flushWorkspaceSnapshot(vaultId) {
        const entry = getEntry(vaultId);
        if (!entry) return;
        try {
          await persistWorkspaceSnapshot(fs, vaultId, entry.workspace);
        } catch {
          // Close must still run. Layout is also written while open, once edits pause.
        }
      },
      purgeForVaultClose(vaultId) {
        fs.resetSession(vaultId);
        store.dispatch({ type: "purge_for_vault_close", vaultId });
      },
      syncWithVaultList(vaults) {
        const openIds = new Set(
          vaults.filter((vault) => isVaultFileManagerRetained(vault)).map((vault) => vault.id),
        );
        const knownIds = new Set(vaults.map((vault) => vault.id));
        for (const vaultId of store.getState().order) {
          if (!knownIds.has(vaultId) || !openIds.has(vaultId)) {
            fs.resetSession(vaultId);
          }
        }
        store.dispatch({ type: "sync_with_vault_list", vaults });
      },
      dispatchWorkspace: (vaultId, action) =>
        store.dispatch({ type: "workspace", vaultId, action }),
      setImportInFlight: (vaultId, inFlight) =>
        store.dispatch({ type: "set_import_in_flight", vaultId, inFlight }),
    };
  }, [fs, store]);

  return <FileManagerContext.Provider value={controller}>{children}</FileManagerContext.Provider>;
}

export function useFileManager(): FileManagerController {
  const controller = useContext(FileManagerContext);
  if (!controller) {
    throw new Error("useFileManager must be used within FileManagerProvider");
  }
  return controller;
}

interface SelectionCache<T> {
  state: FileManagerState;
  select: (state: FileManagerState) => T;
  value: T;
}

/**
 * Draw again only when the selected value changes. `isEqual` keeps the
 * previous value when a new one matches it, so a selector may build objects.
 */
export function useFileManagerSelector<T>(
  select: (state: FileManagerState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { getState, subscribe } = useFileManager();
  const cache = useRef<SelectionCache<T> | null>(null);
  const getSnapshot = () => {
    const state = getState();
    const last = cache.current;
    if (last && last.state === state && last.select === select) return last.value;
    const value = select(state);
    const kept = last && isEqual(last.value, value) ? last.value : value;
    cache.current = { state, select, value: kept };
    return kept;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** One vault's file manager. Another vault's edits do not draw it again. */
export function useFileManagerEntry(vaultId: string): FileManagerEntry | null {
  return useFileManagerSelector((state) => state.entries[vaultId] ?? null);
}

/** Open file managers without their workspaces: the dock and the modal frame. */
export function useFileManagerShell(): FileManagerShell {
  return useFileManagerSelector(fileManagerShell, sameFileManagerShell);
}
