import type { I18nKey } from "../../i18n/catalog";
import { parseBackupSkip, type BackupSkip } from "./keyChanges";

/** What `vault_rebuild` put back. */
export interface VaultRebuildResult {
  /** The header was read back from the key copies the vault's files carry. */
  headerRestored: boolean;
  /**
   * The list of files was built again from the files' records and the
   * backups. False when the header alone was lost and the list opened with it.
   */
  treeRebuilt: boolean;
  /** Files placed in the tree, named by their blob's record or by a backup. */
  files: number;
  /**
   * Blobs left for the next open to set aside for review in the file
   * manager: one nothing names, or whose path a newer file took.
   */
  setAside: number;
  /** The copy of the vault written before the list was built, by its file name. */
  copy: string | null;
  /** Why no copy was written before the list was built. */
  copySkipped: BackupSkip | null;
}

/**
 * The toast once a rebuild lands: what it put back (the files placed and
 * those set aside, or the header alone), then why it ran without a copy of
 * the vault from before when it did.
 */
export function vaultRebuiltToast(
  result: VaultRebuildResult,
  name: string,
  tr: (key: I18nKey, params?: Record<string, string>) => string,
): string {
  const files = String(result.files);
  const placed = !result.treeRebuilt
    ? tr("toast.vault_header_restored", { name })
    : result.setAside > 0
      ? tr("toast.vault_rebuilt_set_aside", { name, files, count: String(result.setAside) })
      : tr("toast.vault_rebuilt", { name, files });
  const skipped = result.copySkipped;
  if (skipped !== "no_room" && skipped !== "failed") return placed;
  return `${placed} ${tr(`toast.vault_rebuild_copy_skipped.${skipped}`)}`;
}

/** A `vault_rebuild` answer, from the wire. */
export function parseVaultRebuildResult(raw: unknown): VaultRebuildResult {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  return {
    headerRestored: body.headerRestored === true,
    treeRebuilt: body.treeRebuilt === true,
    files: count(body.files),
    setAside: count(body.setAside),
    copy: typeof body.copy === "string" ? body.copy : null,
    copySkipped: parseBackupSkip(body.copySkipped),
  };
}
