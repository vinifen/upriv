import { isRpcError } from "../core-rpc/errors";
import { VAULT_ERROR_CODES } from "./errors/codes";

/** What `vault_rebuild` put back. */
export interface VaultRebuildResult {
  /** Files placed in the tree, named by their blob's record or by a backup. */
  files: number;
  /**
   * Blobs left for the next open to set aside for review in the file
   * manager: one nothing names, or whose path a newer file took.
   */
  setAside: number;
}

/** The room the copy a rebuild pins first needs, and the room its drive has. */
export interface VaultRebuildSpace {
  needed: number;
  available: number;
}

/** The sizes of a `vault_rebuild_space_short` refusal; null for any other error. */
export function vaultRebuildSpaceShort(error: unknown): VaultRebuildSpace | null {
  if (!isRpcError(error) || error.code !== VAULT_ERROR_CODES.REBUILD_SPACE_SHORT) return null;
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const { needed, available } = details as { needed?: unknown; available?: unknown };
  if (typeof needed !== "number" || typeof available !== "number") return null;
  return { needed, available };
}

/** A `vault_rebuild` answer, from the wire. */
export function parseVaultRebuildResult(raw: unknown): VaultRebuildResult {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  return { files: count(body.files), setAside: count(body.setAside) };
}
