/** Wire shapes for an open `upriv_plain` folder. Core is the source of these fields. */

export type PlainFolderClass = "local" | "removable" | "network" | "cloud";

export type PlainPlace = "data_folder" | "app" | "vault";

export interface PendingPlainConfirm {
  path: string;
  class: PlainFolderClass;
}

export interface PlainDestination {
  path: string;
  place: PlainPlace;
  class: PlainFolderClass;
}

/** A leftover folder recovery can reach on this computer. */
export interface PlainLeftover {
  path: string;
  /** UTC time the folder was made (RFC 3339). */
  since: string;
  found: boolean;
  files: number;
  bytes: number;
}

export interface PlainCloseSummary {
  saved: number;
  conflicts: number;
  heldDeletions: number;
  wiped: number;
  kept: number;
  totals: { added: number; changed: number; removed: number };
  backupPinned: boolean;
}

export interface PlainHeldStatus {
  heldDeletions: string[];
  heldCount: number;
}

export interface PlainHolder {
  name: string;
  pid: number;
}

/** What recovery offers once the leftover lookup has finished. */
export interface PlainRecoveryOffers {
  /** A leftover folder is still there and recovery wipes it. */
  remove: boolean;
}

export type PlainRecoveryAction = { kind: "resume_store" } | { kind: "remove_folder" };

/** Unlock was dismissed while core waited for the folder confirm. Not a failure. */
export const PLAIN_OPEN_CANCELLED = "plain_open_cancelled";
