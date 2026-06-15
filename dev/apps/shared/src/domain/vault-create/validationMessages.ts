import type { CreateVaultValidationCode } from "./validate";

export const CREATE_VAULT_ERROR_KEYS = {
  empty: "vault.name.empty",
  invalid_chars: "vault.name.invalid_chars",
  trailing: "vault.name.trailing",
  reserved: "vault.name.reserved",
  too_long: "vault.name.too_long",
  duplicate: "vault.create.error.duplicate",
  source_missing: "vault.create.error.source_missing",
  import_file_missing: "vault.create.error.import_file_missing",
  password_empty: "vault.create.error.password_empty",
  password_mismatch: "vault.create.password_mismatch",
  password_not_validated: "vault.create.error.password_not_validated",
  password_wrong: "error.wrong_password",
} as const satisfies Record<CreateVaultValidationCode, string>;

export type CreateVaultErrorKey =
  (typeof CREATE_VAULT_ERROR_KEYS)[CreateVaultValidationCode] | "vault.create.error.generic";

export function createVaultErrorKey(code: CreateVaultValidationCode): CreateVaultErrorKey {
  return CREATE_VAULT_ERROR_KEYS[code] ?? "vault.create.error.generic";
}
