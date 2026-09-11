/** Runtime session state while the app is running. */
export type VaultSession = "open" | "closing" | "recovery";

/**
 * Storage mode from `config.toml` → `[storage] mode`.
 *
 * - `encrypted_dir` — default. Rest = `contents/`. While open: decrypt in RAM
 *   (FUSE/WinFsp on desktop; in-app file manager on mobile).
 * - `upriv_plain` — rest = `contents/`. While open: plaintext under the open
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
 */
export type VaultDisplayStatus = "open" | "closed" | "recovery" | "closing" | "opening";

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
}

/** Resolve the badge/row style status from backend fields. */
export function resolveVaultDisplayStatus(row: VaultRow): VaultDisplayStatus {
  if (row.session === "recovery") return "recovery";
  if (row.session === "closing") return "closing";
  if (row.session === "open") return "open";
  return "closed";
}

/** Whether the vault should have an active file-manager workspace. */
export function isVaultFileManagerEligible(row: VaultRow): boolean {
  return resolveVaultDisplayStatus(row) === "open";
}

/** List row status including in-flight or queued open/close pipelines (runtime only). */
export function resolveVaultListStatus(
  row: VaultRow,
  pipeline: {
    openingVaultIds?: readonly string[];
    closingVaultIds?: readonly string[];
  } = {},
): VaultDisplayStatus {
  if (pipeline.openingVaultIds?.includes(row.id)) return "opening";
  if (pipeline.closingVaultIds?.includes(row.id)) return "closing";
  return resolveVaultDisplayStatus(row);
}
