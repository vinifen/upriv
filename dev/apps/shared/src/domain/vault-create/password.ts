import { importSetsVaultPassword } from "./importKind";
import type { CreateVaultDraft } from "./types";

/**
 * The wizard asks for a new vault password: a vault from scratch, or an import
 * that wraps its files in a new store. A `.7z` asks for its own password, and a
 * store `.zip` or a backup keeps the one it has.
 */
export function createVaultSetsPassword(draft: CreateVaultDraft): boolean {
  return draft.source !== "import" || importSetsVaultPassword(draft);
}
