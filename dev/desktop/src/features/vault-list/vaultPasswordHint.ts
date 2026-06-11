import { getMockVaultSettings } from "./mockVaultSettings";
import type { VaultListItem } from "./types";

/** Password hint from row or vault config (mock until `vault_list` returns `password_hint`). */
export function resolveVaultPasswordHint(
  vault: Pick<VaultListItem, "id" | "passwordHint">,
): string | undefined {
  const fromRow = vault.passwordHint?.trim();
  if (fromRow) return fromRow;

  const fromConfig = getMockVaultSettings(vault.id).vault.password_hint?.trim();
  return fromConfig || undefined;
}
