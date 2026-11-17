import { parseFolderState, type FolderState } from "./switches";

/**
 * A row's status, for its line in a list: whether the folder answers and
 * takes a write (tier 2), then what it holds (tier 3). Each row is its own
 * `folder_status` call, with its own limit.
 */
export interface FolderStatusDetails {
  freeBytes: number | null;
  /** Unlocked folders: the vaults open there now. */
  openVaults: string[];
  /** Unlocked folders: plain-text folders this device left there. */
  plainLeft: number;
  /** Unlocked folders: an encrypted vault's folder cannot live on this file system. */
  noEncryptedFolder: boolean;
  /** Backups: the zips it holds, and their size. */
  zips: number;
  zipBytes: number;
  /** Backups of a vault: the size of its next zip. */
  nextZipBytes: number | null;
}

export interface FolderStatus {
  state: FolderState;
  details: FolderStatusDetails | null;
}

/** What a folder of the data folder list holds, once it answers. */
export type DataFolderContent = "valid" | "incomplete" | "empty" | "unreadable";

export interface DataFolderStatus {
  state: FolderState;
  content: DataFolderContent | null;
  /** A valid data folder: its vaults (hidden ones not counted) and about how much it holds. */
  details: { vaults: number; sizeBytes: number } | null;
}

function num(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export function parseFolderStatus(raw: unknown): FolderStatus {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const details =
    typeof body.details === "object" && body.details !== null
      ? (body.details as Record<string, unknown>)
      : null;
  return {
    state: parseFolderState(body.state),
    details: details
      ? {
          freeBytes: typeof details.freeBytes === "number" ? details.freeBytes : null,
          openVaults: Array.isArray(details.openVaults)
            ? details.openVaults.filter((name): name is string => typeof name === "string")
            : [],
          plainLeft: num(details.plainLeft),
          noEncryptedFolder: details.noEncryptedFolder === true,
          zips: num(details.zips),
          zipBytes: num(details.zipBytes),
          nextZipBytes: typeof details.nextZipBytes === "number" ? details.nextZipBytes : null,
        }
      : null,
  };
}

const CONTENTS = new Set<DataFolderContent>(["valid", "incomplete", "empty", "unreadable"]);

export function parseDataFolderStatus(raw: unknown): DataFolderStatus {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const content =
    typeof body.content === "string" && CONTENTS.has(body.content as DataFolderContent)
      ? (body.content as DataFolderContent)
      : null;
  const details =
    typeof body.details === "object" && body.details !== null
      ? (body.details as Record<string, unknown>)
      : null;
  return {
    state: parseFolderState(body.state),
    content,
    details: details ? { vaults: num(details.vaults), sizeBytes: num(details.sizeBytes) } : null,
  };
}
