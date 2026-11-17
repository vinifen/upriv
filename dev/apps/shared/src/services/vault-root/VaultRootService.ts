import type { DataFolderChoice, DataFolderStatus, ListChanges } from "../../domain/folder-lists";
import type {
  DataFolderApplied,
  DataFolderListView,
  DataFolderSearchResult,
  IncompleteReplacePolicy,
  VaultRootBootstrapPrefs,
  VaultRootResolveResult,
} from "../../domain/vault-root";

/** What `apply` sends. */
export interface DataFolderApplyRequest {
  /** What the person changed in the list. Empty uses the selection as it is. */
  changes: ListChanges<DataFolderChoice>;
  /** Start from an empty list in place of one that cannot be read. */
  newList?: boolean;
  /** How to replace a broken `.upriv` in the folder the list selects. */
  replacePolicy?: IncompleteReplacePolicy;
  /** What a new data folder starts with. A folder that opens keeps its own. */
  bootstrap: VaultRootBootstrapPrefs;
  /**
   * A phone: the copy of the private app-folder `.upriv` into the folder the
   * list selects runs as this core job. It has no deadline; Stop leaves the
   * original where it was (`job_cancelled`). Desktop leaves it out.
   */
  job?: string;
}

/**
 * The data folder: which one this device uses (`resolve`), its list, and the
 * apply that saves the list and opens the folder it selects. Desktop → daemon
 * RPC; phone → in-process core, with the storage-access trees mounted first.
 *
 * `apply` is the only call that changes the data folder in use. Setup, the
 * Gate's screens, and the Data folder window call it; the settings context
 * then reloads.
 */
export interface VaultRootService {
  resolve(options?: {
    explicitPath?: string | null;
    /** Debug-only; honored by the daemon only when `UPRIV_DEV` is set. */
    binaryDir?: string | null;
  }): Promise<VaultRootResolveResult>;

  /**
   * Every device's group of the data folder list, and where Default is.
   * `newList` leaves the file unread and answers an empty list: Start a new
   * list, when the file cannot be read.
   */
  list(options?: { newList?: boolean }): Promise<DataFolderListView>;

  /** The status of a folder of the list: `null` is Default. Each its own call and limit. */
  status(path: string | null): Promise<DataFolderStatus>;

  apply(request: DataFolderApplyRequest): Promise<DataFolderApplied>;

  /**
   * After the selected folder did not answer at launch: look for one that
   * does, as the job `job`. One that answers becomes the selection.
   */
  search(job: string): Promise<DataFolderSearchResult>;

  /** Where Add folder's picker starts on desktop (`~/Documents/Upriv`). */
  suggestedCustomRootPath(): Promise<string>;

  /**
   * Native folder picker when available; otherwise `null`.
   * `defaultPath` pre-selects that folder in the dialog when supported.
   * `title` is best-effort: desktop usually honors it; Android may ignore it.
   */
  pickFolder(defaultPath?: string | null, title?: string | null): Promise<string | null>;
}
