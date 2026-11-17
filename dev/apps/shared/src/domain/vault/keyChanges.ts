import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";
import { VAULT_ERROR_CODES } from "./errors/codes";

/**
 * Why a zip a flow writes before it changes `store/` was not written: the
 * switch was off, neither the data folder nor the folder in use had room, or
 * it failed. The flow goes on without it.
 */
export type BackupSkip = "off" | "no_room" | "failed";

/** Where the key copies of a vault's files stand once a pass ends. */
export type KeyCopies = "done" | "waiting";

/** What a password change did (`vault_change_password`). */
export interface PasswordChangeResult {
  /** The save written before the change, by its file name. */
  backup: string | null;
  /** Why no save was written. */
  backupSkipped: BackupSkip | null;
  /** Files with a part the vault could not read, or whose data is missing. */
  unreadable: number;
  keyCopies: KeyCopies;
}

/** What Finish did (`vault_password_change_finish`). */
export interface PasswordChangeFinishResult {
  unreadable: number;
  keyCopies: KeyCopies;
}

/** What an unlock-RAM change did (`vault_change_kdf`). */
export interface UnlockRamChangeResult {
  keyCopies: KeyCopies;
}

/** Where an open vault's keys stand (`vault_key_status`), for Info. */
export interface VaultKeyStatus {
  /** Files with a part on a key an unfinished password change left: what Finish rewrites. */
  filesWaiting: number;
  /** Some files' key copies are behind the vault's header. */
  keyCopiesDue: boolean;
  /** The job after the open updates them now. */
  keyCopiesUpdating: boolean;
}

/** The room a password change needs on the drive, and the room it has. */
export interface PasswordChangeSpace {
  needed: number;
  available: number;
}

export function parseBackupSkip(raw: unknown): BackupSkip | null {
  return raw === "off" || raw === "no_room" || raw === "failed" ? raw : null;
}

function parseKeyCopies(raw: unknown): KeyCopies {
  return raw === "waiting" ? "waiting" : "done";
}

function body(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parsePasswordChangeResult(raw: unknown): PasswordChangeResult {
  const record = body(raw);
  return {
    backup: typeof record.backup === "string" ? record.backup : null,
    backupSkipped: parseBackupSkip(record.backupSkipped),
    unreadable: count(record.unreadable),
    keyCopies: parseKeyCopies(record.keyCopies),
  };
}

export function parsePasswordChangeFinishResult(raw: unknown): PasswordChangeFinishResult {
  const record = body(raw);
  return { unreadable: count(record.unreadable), keyCopies: parseKeyCopies(record.keyCopies) };
}

export function parseUnlockRamChangeResult(raw: unknown): UnlockRamChangeResult {
  return { keyCopies: parseKeyCopies(body(raw).keyCopies) };
}

/** `vault_key_copies_update`: `{ keyCopies }`. */
export function parseKeyCopiesUpdate(raw: unknown): KeyCopies {
  return parseKeyCopies(body(raw).keyCopies);
}

/** `vault_key_status`: null while the vault has no open session. */
export function parseVaultKeyStatus(raw: unknown): VaultKeyStatus | null {
  const record = body(raw);
  if (record.open !== true) return null;
  return {
    filesWaiting: count(record.filesWaiting),
    keyCopiesDue: record.keyCopiesDue === true,
    keyCopiesUpdating: record.keyCopiesUpdating === true,
  };
}

/** A line a change that ended leaves in its window: a text key and its values. */
export interface KeyChangeReportLine {
  key: I18nKey;
  params?: Record<string, string>;
}

/**
 * What a password change or Finish that ended leaves in its window: what it
 * did, or that it stopped. `null` when it failed, since the window shows the
 * error instead.
 */
export function passwordChangeReportLines(outcome: {
  kind: "change" | "finish";
  result: PasswordChangeResult | PasswordChangeFinishResult | null;
  stopped: boolean;
}): KeyChangeReportLine[] | null {
  const finish = outcome.kind === "finish";
  const { result } = outcome;
  if (!result) {
    if (!outcome.stopped) return null;
    return [
      { key: finish ? "vault.change_password.finish_stopped" : "vault.change_password.stopped" },
    ];
  }
  const waiting = result.keyCopies === "waiting";
  const lines: KeyChangeReportLine[] = [
    {
      key: finish
        ? waiting
          ? "vault.change_password.finished_key_copies_waiting"
          : "vault.change_password.finished"
        : waiting
          ? "vault.change_password.success_key_copies_waiting"
          : "vault.change_password.success",
    },
  ];
  if ("backup" in result) {
    if (result.backup) lines.push({ key: "vault.change_password.backup_kept" });
    else if (result.backupSkipped === "no_room" || result.backupSkipped === "failed") {
      lines.push({ key: `vault.change_password.backup_skipped.${result.backupSkipped}` });
    }
  }
  if (result.unreadable > 0) {
    lines.push({
      key: "vault.change_password.unreadable_count",
      params: { count: String(result.unreadable) },
    });
  }
  return lines;
}

/** What an unlock-RAM change that ended leaves in its window; `null` when it failed. */
export function unlockRamChangeReportLines(outcome: {
  result: UnlockRamChangeResult | null;
  stopped: boolean;
}): KeyChangeReportLine[] | null {
  if (outcome.result) {
    return [
      {
        key:
          outcome.result.keyCopies === "waiting"
            ? "vault.change_kdf.success_key_copies_waiting"
            : "vault.change_kdf.success",
      },
    ];
  }
  return outcome.stopped ? [{ key: "vault.change_kdf.stopped" }] : null;
}

/** The sizes of a `password_change_space_short` refusal; null for any other error. */
export function passwordChangeSpaceShort(error: unknown): PasswordChangeSpace | null {
  if (!isRpcError(error) || error.code !== VAULT_ERROR_CODES.PASSWORD_CHANGE_SPACE_SHORT) {
    return null;
  }
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const { needed, available } = details as { needed?: unknown; available?: unknown };
  if (typeof needed !== "number" || typeof available !== "number") return null;
  return { needed, available };
}
