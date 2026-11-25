import type { VaultRow } from "../vault/types";
import type { PlainLeftover } from "../vault-plain/types";

/**
 * Why a vault is in recovery, as its recovery window shows it, and so its
 * way out. The first that holds wins:
 * - `loading`: a leftover plain-text folder is on record and its lookup has
 *   not answered yet. Nothing is offered.
 * - `remove_folder`: that folder is still there. The wipe is the only step.
 * - `finish_password_change`: a password change left files on an earlier
 *   key. Finish, on the Password screen, or an unlock that leaves it.
 * - `import_unfinished`: a quit or a crash cut off the import that filled
 *   the vault. An unlock keeps the files it got in, or the vault is deleted.
 * - `password_change_pending`: a password change did not finish. The unlock
 *   asks for the new password.
 * - `unfinished_close`: a close did not finish. The unlock opens the store
 *   as it is.
 */
export type VaultRecoveryCase =
  | "loading"
  | "remove_folder"
  | "finish_password_change"
  | "import_unfinished"
  | "password_change_pending"
  | "unfinished_close";

/**
 * The recovery case of `vault`. `leftover` is its plain-text leftover as
 * looked up (`undefined` while the lookup runs, `null` for none): a leftover
 * follows its record, whatever the vault's mode says.
 */
export function vaultRecoveryCase(
  vault: Pick<VaultRow, "plainLeftover" | "passwordChange" | "importUnfinished">,
  leftover: PlainLeftover | null | undefined,
): VaultRecoveryCase {
  if (vault.plainLeftover === true && leftover === undefined) return "loading";
  if (leftover?.found === true) return "remove_folder";
  if (vault.passwordChange === "unfinished") return "finish_password_change";
  if (vault.importUnfinished === true) return "import_unfinished";
  if (vault.passwordChange === "pending") return "password_change_pending";
  return "unfinished_close";
}
