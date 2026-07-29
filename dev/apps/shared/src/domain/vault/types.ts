/** Persisted vault state on disk (never `open` — runtime only). */
export type VaultPersistence = "closed" | "sealed";

/** Runtime session state while the app is running. */
export type VaultSession = "open" | "closing" | "recovery";

/**
 * Storage mode from `config.toml` → `[storage] mode`.
 *
 * - `encrypted_dir` — encrypted store on disk + virtual mount (default; optional `closed` cache)
 * - `store_only` — encrypted store is primary; `.7z` on seal/export (less Plan B while open)
 * - `ram_only` — `.7z` + RAM session only; no store; lock always seals (volatile edits)
 * - `plain` — while open: plaintext workspace **+** `.7z` on disk; lock always seals → only `.7z`
 * - `plain_only` — while open: plaintext workspace only (no `.7z`); lock always seals → only `.7z`
 */
export type StorageMode =
  | "encrypted_dir"
  | "plain"
  | "plain_only"
  | "ram_only"
  | "store_only";

export const STORAGE_MODES = [
  "encrypted_dir",
  "store_only",
  "ram_only",
  "plain",
  "plain_only",
] as const satisfies readonly StorageMode[];

/** Modes that can keep an on-disk cache between sessions (`closed`). */
export function storageModeHasClosedCache(mode: StorageMode): boolean {
  return mode === "encrypted_dir" || mode === "store_only";
}

/** Modes where lock always seals (no `closed` persistence). */
export function storageModeSealOnly(mode: StorageMode): boolean {
  return mode === "plain" || mode === "plain_only" || mode === "ram_only";
}

/** Modes that persist decrypted file bytes on the vault volume while open. */
export function storageModeIsPlaintext(mode: StorageMode): boolean {
  return mode === "plain" || mode === "plain_only";
}

/**
 * Unified display status for list rows (PRD §1.7, SDD §8.2).
 * Derived from session + persistence + recovery detection.
 */
export type VaultDisplayStatus = "open" | "closed" | "sealed" | "recovery" | "closing" | "opening";

/** Row DTO returned by `vault_list` (SDD §8.2.6). */
export interface VaultRow {
  id: string;
  displayName: string;
  persistence: VaultPersistence;
  session: VaultSession | null;
  storageMode: StorageMode;
  order?: number;
  passwordHint?: string;
  canSeal: boolean;
  /** `[vault] hidden` — omitted from list unless show-hidden is active. */
  hidden?: boolean;
}

/**
 * Resolve the badge/row style status from backend fields.
 *
 * Invariant: seal-only modes (`plain`, `plain_only`, `ram_only`) never persist `persistence: "closed"` —
 * not-open is always `sealed` (PRD RF-53). A malformed DTO still renders as sealed.
 */
export function resolveVaultDisplayStatus(row: VaultRow): VaultDisplayStatus {
  if (row.session === "recovery") return "recovery";
  if (row.session === "closing") return "closing";
  if (row.session === "open") return "open";
  if (storageModeSealOnly(row.storageMode)) return "sealed";
  return row.persistence === "sealed" ? "sealed" : "closed";
}

function isDevEnvironment(): boolean {
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as { env?: { DEV?: boolean } }).env;
    if (env?.DEV === true) return true;
    if (env?.DEV === false) return false;
  }
  const globalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  return globalDev === true;
}

function devWarn(message: string): void {
  const c = (globalThis as { console?: { warn: (msg: string) => void } }).console;
  c?.warn(message);
}

/** Dev-only guard for mock seed rows that violate the plain-storage invariant. */
export function assertPlainVaultInvariant(row: VaultRow): void {
  if (!isDevEnvironment()) return;
  if (
    storageModeSealOnly(row.storageMode) &&
    row.persistence === "closed" &&
    row.session !== "open"
  ) {
    devWarn(
      `[upriv] seal-only vault "${row.id}" (${row.storageMode}) has persistence "closed" while not open — UI shows sealed.`,
    );
  }
}

/**
 * Whether the row may show the seal split control.
 * Modes with a closed cache (`encrypted_dir`, `store_only`) — while open or resting `closed`.
 */
export function resolveVaultCanSeal(row: VaultRow): boolean {
  if (!storageModeHasClosedCache(row.storageMode)) return false;
  if (row.session === "recovery" || row.session === "closing") return false;
  if (row.session === "open") return true;
  return row.persistence === "closed";
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
