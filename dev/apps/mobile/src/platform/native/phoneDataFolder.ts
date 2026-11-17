import {
  DATA_FOLDER_LIST,
  JOB_ERROR_CODES,
  RpcError,
  isSafContentUri,
  type DataFolderChoice,
  type DataFolderListView,
  type DeviceGroups,
  type ListChanges,
} from "@upriv/shared";
import { rpcDataFolderList, rpcDeviceInfo } from "@/lib/rpc";
import { isAndroidDocumentsDefaultGrant } from "./documentsGrant";
import { pickVaultRootFolder } from "./pickVaultRootFolder";
import {
  mountSafRoot,
  safDocumentsGrant,
  safDocumentsInitialUri,
  safPersist,
  unmountSafRoot,
} from "./safVaultRoot";

/**
 * The phone's data folder is the one Rust reaches at `/upriv-saf-root`: the
 * tree this device's list selects. A row's picked tree is mounted there, and
 * Default is Documents/Upriv in the held Documents grant.
 */

/** What `/upriv-saf-root` serves now: a row's tree, Default's grant, or nothing. */
export type DataFolderMount = { kind: "row"; tree: string } | { kind: "default"; tree: string };

let mounted: DataFolderMount | null = null;
let hereId: Promise<string | null> | null = null;

/** This phone's device ID; `null` while it has none (its list cannot change). */
export function phoneDeviceId(): Promise<string | null> {
  if (!hereId) {
    hereId = rpcDeviceInfo().then(
      (device) => device.id,
      (error: unknown) => {
        hereId = null;
        throw error;
      },
    );
  }
  return hereId;
}

/** The tree the data folder root serves now. */
export function mountedDataFolder(): DataFolderMount | null {
  return mounted;
}

/**
 * What a list selects on this phone, its change applied: a row's tree or
 * Default; `null` when the selected row names no picked tree.
 */
export function selectedDataFolder(
  groups: DeviceGroups<DataFolderChoice>,
  deviceId: string | null,
  changes?: ListChanges<DataFolderChoice>,
): { kind: "row"; tree: string } | { kind: "default" } | null {
  const change = deviceId ? changes?.groups[deviceId] : undefined;
  const saved = deviceId ? groups[deviceId] : undefined;
  const selection = change?.selected ?? saved?.selected ?? DATA_FOLDER_LIST.fallback;
  if (selection === "default") return { kind: "default" };
  if (typeof selection !== "number") return null;
  const rows = change?.rows ?? saved?.rows ?? [];
  const tree = rows.find((row) => row.number === selection)?.path.trim() ?? "";
  return isSafContentUri(tree) ? { kind: "row", tree } : null;
}

function mountAt(next: DataFolderMount): void {
  try {
    mountSafRoot(next.tree);
    mounted = next;
  } catch (error) {
    // A drive that is away leaves the root empty: core reports the selection failed.
    unmountDataFolder();
    throw error;
  }
}

export function unmountDataFolder(): void {
  unmountSafRoot();
  mounted = null;
}

/**
 * Mount the data folder `view` selects on this phone, as the next resolve or
 * settings read needs it. A tree that is away, or Default with no Documents
 * grant, leaves the root empty: core then reports the selected choice as not
 * answering, or the first run.
 */
export async function mountSelectedDataFolder(view?: DataFolderListView): Promise<void> {
  let list: DataFolderListView;
  try {
    list = view ?? (await rpcDataFolderList(false));
  } catch {
    // An unreadable list: resolve reports it.
    unmountDataFolder();
    return;
  }
  const selected = selectedDataFolder(list.groups, await phoneDeviceId());
  const tree = selected?.kind === "row" ? selected.tree : selected ? safDocumentsGrant() : null;
  if (!selected || !tree) {
    unmountDataFolder();
    return;
  }
  if (mounted?.tree === tree) return;
  try {
    mountAt(selected.kind === "row" ? { kind: "row", tree } : { kind: "default", tree });
  } catch {
    // Unmounted already; core reports the folder that does not answer.
  }
}

/**
 * Mount Default's Documents grant. With none held yet, the system screen
 * opens on Documents, and the person confirms it once: `Upriv` is made
 * inside. A cancel stops the apply (`job_cancelled`); another folder is
 * refused, since Default is Documents/Upriv.
 */
export async function mountDefaultDataFolder(): Promise<void> {
  let grant = safDocumentsGrant();
  if (!grant) {
    const picked = await pickVaultRootFolder(safDocumentsInitialUri());
    if (!picked) throw new RpcError(JOB_ERROR_CODES.CANCELLED, "Documents was not confirmed");
    if (!isAndroidDocumentsDefaultGrant(picked)) {
      throw new RpcError("documents_grant_rejected", "Default is Documents/Upriv", {
        path: picked,
      });
    }
    safPersist(picked);
    grant = picked;
  }
  mountAt({ kind: "default", tree: grant });
}

/**
 * Serve Default's Documents grant at the data folder root, where a search
 * checks Default; with no grant held, or one that does not answer, the root
 * stays empty and core reports Default as not answering. The next resolve
 * mounts what the list selects again.
 */
export function mountDefaultForSearch(): void {
  const grant = safDocumentsGrant();
  if (!grant) {
    unmountDataFolder();
    return;
  }
  try {
    mountAt({ kind: "default", tree: grant });
  } catch {
    // Unmounted already.
  }
}

/** Mount a row's picked tree at the data folder root. */
export function mountRowDataFolder(tree: string): void {
  safPersist(tree);
  mountAt({ kind: "row", tree });
}

/** Put the root back on what it served before a failed apply. */
export function restoreDataFolder(previous: DataFolderMount | null): void {
  if (!previous) {
    unmountDataFolder();
    return;
  }
  try {
    mountAt(previous);
  } catch {
    // The previous folder went away meanwhile; the next resolve reports it.
  }
}
