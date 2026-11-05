/** Runtime session state while the app is running. */
export type VaultSession = "open" | "closing" | "recovery";

/**
 * Storage mode from `config.toml` → `[storage] mode`.
 *
 * - `encrypted_dir` — default. Rest = `store/`. While open: decrypt in RAM
 *   (FUSE/WinFsp on desktop; in-app file manager on mobile).
 * - `upriv_plain` — rest = `store/`. While open: plaintext under the open
 *   mount folder on disk (wipe on close) — not app `[workspace].path` alone.
 */
export type StorageMode = "encrypted_dir" | "upriv_plain";

export const STORAGE_MODES = [
  "encrypted_dir",
  "upriv_plain",
] as const satisfies readonly StorageMode[];

/** `upriv_plain` writes decrypted bytes under the open mount folder while open. */
export function storageModeIsPlaintext(mode: StorageMode): boolean {
  return mode === "upriv_plain";
}

/**
 * Unified display status for list rows.
 * Derived from session + recovery. On disk the vault is closed (lock = close).
 * `creating` / `opening` / `closing` / `queued` are list/runtime badges (row +
 * unlock/lock modal hints), not a full-screen pipeline overlay.
 * `queued` = FIFO job waiting; active job uses opening/closing/creating.
 * `exporting` / `backing_up` / `changing_password` / `changing_kdf` are closed-vault work.
 * `recovering` is Remove the folder wiping a leftover plain-text folder.
 * The row names that work and open stays refused until it finishes.
 */
export type VaultDisplayStatus =
  | "open"
  | "closed"
  | "recovery"
  | "recovering"
  | "closing"
  | "opening"
  | "creating"
  | "queued"
  | "exporting"
  | "backing_up"
  | "changing_password"
  | "changing_kdf";

/**
 * In-flight or queued open / close / create (renderer FIFO, not `vault_list`).
 * `openingVaultIds` = active open run only.
 * `queuedVaultIds` = waiting open and close jobs (display `queued`).
 * Waiting create stays in `creatingVaultIds`.
 * `queuedOpenVaultIds` = waiting opens only, so a queued close is not an unlock to resume.
 */
export type VaultPipelineListStatus = {
  openingVaultIds?: readonly string[];
  closingVaultIds?: readonly string[];
  creatingVaultIds?: readonly string[];
  /** Waiting open and close jobs — display as `queued` until they start. */
  queuedVaultIds?: readonly string[];
  /** Waiting open jobs. Absent means every `queued` row can resume unlock. */
  queuedOpenVaultIds?: readonly string[];
  /** Active close that core reports is writing the close backup. Still displays `closing`. */
  backingUpVaultIds?: readonly string[];
  /** Running or waiting closes already told to finish the Close now way. */
  closeNowVaultIds?: readonly string[];
  /** Closed vault whose export is in flight. Displays `exporting`. */
  exportingVaultIds?: readonly string[];
  /**
   * Export data folder is copying every vault into one zip. Every row displays
   * `exporting` and refuses to open until it ends.
   */
  dataFolderExporting?: boolean;
  /** Closed vault whose Back up now zip is in flight. Displays `backing_up`. */
  backupJobVaultIds?: readonly string[];
  /**
   * Vault whose backups a backup export is copying. Not a display status: the
   * vault stays free, and only its rename and delete wait (`vaultDeleteHold`,
   * edit-policy `backupExportLocked`).
   */
  backupExportVaultIds?: readonly string[];
  /** Vault whose leftover plain-text folder is being wiped. Displays `recovering`. */
  recoveringVaultIds?: readonly string[];
  /** Closed vault whose password rewrap is in flight. */
  passwordChangeVaultIds?: readonly string[];
  /** Closed vault whose unlock-RAM rewrap is in flight. */
  kdfChangeVaultIds?: readonly string[];
  /**
   * The work behind each busy status, by vault id: its clock and what the
   * row's Stop does. A vault with no entry shows its status alone.
   */
  rowWork?: Readonly<Record<string, VaultRowWork>>;
};

/**
 * What the row's Stop does for its work: `ready` stops it, `final` is the
 * step it cannot stop (Stop shows disabled), `stopping` waits for core.
 */
export type VaultRowStop = "ready" | "final" | "stopping";

/** The work behind a row's busy status. */
export interface VaultRowWork {
  /**
   * When core started it. `null` while it waits for its turn: the row says
   * Queued… and counts nothing.
   */
  startedAt: number | null;
  /** Show how long it has run. Off for work that is short by nature (an encrypted unlock). */
  timed: boolean;
  /** `null` when the row has no Stop for it: a close stops with Close now. */
  stop: VaultRowStop | null;
  /** When Stop was asked for; the row counts "Stopping…" from here. */
  stoppingSince: number | null;
}

/** Work for a row from a core job's state. */
export function vaultRowJobWork(job: {
  startedAt: number | null;
  stoppable: boolean;
  stoppingSince: number | null;
  timed?: boolean;
}): VaultRowWork {
  const stop: VaultRowStop =
    job.stoppingSince !== null ? "stopping" : job.stoppable ? "ready" : "final";
  return {
    startedAt: job.startedAt,
    timed: job.timed ?? true,
    stop,
    stoppingSince: job.stoppingSince,
  };
}

/** The moment the row's counter counts from, or `null` for no counter. */
export function vaultRowWorkClock(work: VaultRowWork | null | undefined): number | null {
  if (!work) return null;
  if (work.stop === "stopping") return work.stoppingSince;
  return work.timed ? work.startedAt : null;
}

/** Password or unlock-RAM rewrap started from vault settings. */
export type VaultRewrapKind = "password" | "kdf";

export function isVaultPipelineDisplayBusy(status: VaultDisplayStatus): boolean {
  return (
    status === "opening" ||
    status === "closing" ||
    status === "creating" ||
    status === "queued" ||
    status === "exporting" ||
    status === "backing_up" ||
    status === "recovering" ||
    status === "changing_password" ||
    status === "changing_kdf"
  );
}

/**
 * List status where the unlock credential UI can be resumed (active open or
 * waiting open) — the row's button, and a click on the row, while Opening… or Queued….
 */
export function isVaultOpenCredentialResumeStatus(status: VaultDisplayStatus): boolean {
  return status === "opening" || status === "queued";
}

/**
 * Active open, or a waiting open. A waiting close also displays as `queued`,
 * and that row must not reopen the unlock dialog.
 */
export function isVaultOpenResumeTarget(
  status: VaultDisplayStatus,
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  if (status === "opening") return true;
  if (status !== "queued") return false;
  const waitingOpens = pipeline.queuedOpenVaultIds;
  if (!waitingOpens) return true;
  return waitingOpens.includes(vaultId);
}

/** A close runs or waits on this row, and Close now was not asked for yet. */
export function vaultCloseNowOffered(
  status: VaultDisplayStatus,
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  if (pipeline.closeNowVaultIds?.includes(vaultId)) return false;
  return status === "closing" || isVaultCloseQueued(vaultId, pipeline);
}

/** Waiting close. The session is still open until that job starts. */
export function isVaultCloseQueued(
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  if (!pipeline.queuedVaultIds?.includes(vaultId)) return false;
  if (pipeline.queuedOpenVaultIds?.includes(vaultId)) return false;
  return true;
}

/** Unlock applies: a closed or recovery vault, or a waiting open whose password window can reopen. */
export function isVaultListRowUnlockTarget(status: VaultDisplayStatus): boolean {
  return status === "closed" || status === "recovery" || isVaultOpenCredentialResumeStatus(status);
}

/** Row DTO returned by `vault_list` (SDD §8.2.6). */
export interface VaultRow {
  id: string;
  displayName: string;
  session: VaultSession | null;
  storageMode: StorageMode;
  order?: number;
  passwordHint?: string;
  /** `[vault] hidden` — omitted from list and pickers unless show-hidden is active. */
  hidden?: boolean;
  /** A plaintext folder from an earlier session waits to be removed. */
  plainLeftover?: boolean;
}

/**
 * Session-only status (no in-flight pipeline).
 * UI "Closed" labels must use `resolveVaultListStatus` / `isVaultListClosed`.
 */
export function resolveVaultDisplayStatus(row: VaultRow): VaultDisplayStatus {
  if (row.session === "recovery") return "recovery";
  if (row.session === "closing") return "closing";
  if (row.session === "open") return "open";
  return "closed";
}

/** Whether the vault should have an active file-manager workspace.
 * Eligible ⇔ `session === "open"` on the list DTO (after open `onComplete`).
 * Opening/creating/closing never qualify — there is no “core open, UI still
 * opening” window because the session flips to `open` only when the pipeline finishes.
 */
export function isVaultFileManagerEligible(row: VaultRow): boolean {
  return resolveVaultDisplayStatus(row) === "open";
}

/**
 * Keep an already-open file-manager tab through renderer `closing`.
 * Do not use this to *open* a tab — that stays `isVaultFileManagerEligible`.
 */
export function isVaultFileManagerRetained(row: VaultRow): boolean {
  return row.session === "open" || row.session === "closing";
}

/**
 * Workspace Clear / path wipe must stay blocked while core may still have
 * the vault open (open, renderer closing, or in-flight unlock).
 */
export function isVaultBlockingWorkspaceClear(
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  const status = resolveVaultListStatus(row, pipeline);
  return status === "open" || status === "closing" || status === "opening" || status === "queued";
}

export function listHasVaultBlockingWorkspaceClear(
  vaults: readonly VaultRow[],
  pipeline: VaultPipelineListStatus = {},
): boolean {
  return vaults.some((vault) => isVaultBlockingWorkspaceClear(vault, pipeline));
}

/**
 * Data-folder (vault-root) switch is allowed only for **closed** and **recovery**.
 * Open / opening / closing / creating / queued keep keys or in-flight work on the
 * current root — switching would orphan sessions. No bulk-close helper.
 */
export function isVaultBlockingDataFolderChange(
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  const status = resolveVaultListStatus(row, pipeline);
  return status !== "closed" && status !== "recovery";
}

export function listHasVaultBlockingDataFolderChange(
  vaults: readonly VaultRow[],
  pipeline: VaultPipelineListStatus = {},
): boolean {
  return vaults.some((vault) => isVaultBlockingDataFolderChange(vault, pipeline));
}

/** List row status including active or queued open/close/create pipelines (runtime only). */
export function resolveVaultListStatus(
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): VaultDisplayStatus {
  if (pipeline.creatingVaultIds?.includes(row.id)) return "creating";
  if (pipeline.openingVaultIds?.includes(row.id)) return "opening";
  if (pipeline.closingVaultIds?.includes(row.id)) return "closing";
  if (pipeline.queuedVaultIds?.includes(row.id)) return "queued";
  if (pipeline.exportingVaultIds?.includes(row.id) || pipeline.dataFolderExporting) {
    return "exporting";
  }
  if (pipeline.backupJobVaultIds?.includes(row.id)) return "backing_up";
  if (pipeline.recoveringVaultIds?.includes(row.id)) return "recovering";
  if (pipeline.passwordChangeVaultIds?.includes(row.id)) return "changing_password";
  if (pipeline.kdfChangeVaultIds?.includes(row.id)) return "changing_kdf";
  return resolveVaultDisplayStatus(row);
}

/** True when list status has no open session and no open/close in flight. Recovery OK. */
export function isVaultDisplayStatusQuiet(status: VaultDisplayStatus): boolean {
  return (
    status !== "open" &&
    status !== "opening" &&
    status !== "closing" &&
    status !== "exporting" &&
    status !== "backing_up" &&
    status !== "recovering" &&
    status !== "changing_password" &&
    status !== "changing_kdf"
  );
}

/** True only when the vault is not open and no open/close/create is in flight. */
export function isVaultListClosed(row: VaultRow, pipeline: VaultPipelineListStatus = {}): boolean {
  return resolveVaultListStatus(row, pipeline) === "closed";
}

/** Why Delete must wait: the vault's own state, or a backup export reading its backups. */
export type VaultDeleteHold = "busy" | "backup_export";

/**
 * Delete removes the vault folder. Only a closed vault, or one in recovery,
 * may start it, and not while a backup export copies its backups. `null` when
 * it may start.
 */
export function vaultDeleteHold(
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): VaultDeleteHold | null {
  const status = resolveVaultListStatus(row, pipeline);
  if (status !== "closed" && status !== "recovery") return "busy";
  if (pipeline.backupExportVaultIds?.includes(row.id)) return "backup_export";
  return null;
}
