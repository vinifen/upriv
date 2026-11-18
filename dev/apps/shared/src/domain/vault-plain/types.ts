import type { DeviceRef } from "../device";

/** Wire shapes for an open `upriv_plain` folder. Core is the source of these fields. */

/** Where a plain-text folder physically is, as far as the computer can tell. */
export type PlainFolderClass = "local" | "removable" | "network" | "cloud";

/** What this device can tell about a recorded plain-text folder. */
export type PlainRecordState =
  /** The folder is there with this vault's marker: a leftover to remove. */
  | "leftover"
  /** Proven gone: the record goes. */
  | "gone"
  /** Nothing proves where the folder is: its drive is away, or another drive took its place. */
  | "away"
  /** Another device wrote it, and its folder is not reachable from here. */
  | "elsewhere";

/** A plain-text folder on record, as the vault row shows it. */
export interface PlainRecord {
  /** The device that wrote it. */
  device: DeviceRef;
  path: string;
  /** Names the record for `plain_record_forget`. */
  token: string;
  state: PlainRecordState;
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

/** `vault_plain_remove`. `kept` files could not be wiped: the vault stays in recovery. */
export interface PlainWipe {
  wiped: number;
  kept: number;
}

export interface PlainCloseSummary {
  saved: number;
  conflicts: number;
  heldDeletions: number;
  removed: number;
  kept: number;
  /** The kept files stay in this vault's folder: the row has a leftover to remove. */
  leftover: boolean;
  totals: { added: number; changed: number; removed: number };
  backupPinned: boolean;
}

export interface PlainHeldStatus {
  heldDeletions: string[];
  heldCount: number;
}

/** What recovery offers once the leftover lookup has finished. */
export interface PlainRecoveryOffers {
  /** A leftover folder is still there and recovery wipes it. */
  remove: boolean;
}

export type PlainRecoveryAction = { kind: "resume_store" } | { kind: "remove_folder" };
