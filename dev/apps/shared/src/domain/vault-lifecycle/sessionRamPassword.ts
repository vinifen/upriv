import type { SecurityMode } from "../vault-settings/types";

/**
 * Renderer session-RAM password map.
 *
 * The modal keeps what the user just typed so they can retry. The map holds the
 * in-flight RPC copy (borrowed for open) and, after a successful open, only
 * modes that may lock without retyping (`shouldRetainSessionRamPassword`).
 * `always_prompt` must not keep the string after open. A failed unlock must not
 * leave the attempt in the map.
 */

export function borrowSessionRamPassword(store: Map<string, string>, vaultId: string): string {
  const password = store.get(vaultId) ?? "";
  store.delete(vaultId);
  return password;
}

/** Restore after open when the vault's security mode allows retention.
 * Live open borrows for the RPC and does not call this — hooks restore via
 * `setPasswordInSession` only after `shouldRetainSessionRamPassword` and a
 * generation check so a late getSettings cannot revive a closed session.
 */
export function commitSessionRamPasswordAfterOpen(
  store: Map<string, string>,
  vaultId: string,
  password: string,
): void {
  if (password.length === 0) return;
  store.set(vaultId, password);
}

/** `always_prompt` retypes on lock — do not keep the open password in the map. */
export function shouldRetainSessionRamPassword(mode: SecurityMode): boolean {
  return mode !== "always_prompt";
}
