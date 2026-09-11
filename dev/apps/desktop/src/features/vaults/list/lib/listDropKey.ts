/** Drop-target marker for desktop pointer drag in the vault list. */
export const VAULT_LIST_DROP_KEY = "data-vault-list-drop-key";

export function vaultListDropKeyProps(key: string) {
  return { [VAULT_LIST_DROP_KEY]: key } as Record<string, string>;
}
