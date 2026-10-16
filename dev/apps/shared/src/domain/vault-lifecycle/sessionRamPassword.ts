/**
 * Renderer session-RAM password map.
 *
 * The modal keeps what the user just typed so they can retry. The map holds the
 * in-flight RPC copy (borrowed for open) and, after a successful open, the
 * password string until lock or quit. A failed unlock must not leave the
 * attempt in the map.
 */

export function borrowSessionRamPassword(store: Map<string, string>, vaultId: string): string {
  const password = store.get(vaultId) ?? "";
  store.delete(vaultId);
  return password;
}
