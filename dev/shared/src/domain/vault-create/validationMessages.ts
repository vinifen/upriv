import type { CreateVaultValidationCode } from "../vault-create/validate";

export function createVaultErrorKey(code: CreateVaultValidationCode): string {
  switch (code) {
    case "empty":
      return "vault.name.empty";
    case "invalid_chars":
      return "vault.name.invalid_chars";
    case "trailing":
      return "vault.name.trailing";
    case "reserved":
      return "vault.name.reserved";
    case "too_long":
      return "vault.name.too_long";
    case "duplicate":
      return "vault.create.error.duplicate";
    case "source_missing":
      return "vault.create.error.source_missing";
    case "import_file_missing":
      return "vault.create.error.import_file_missing";
    case "password_empty":
      return "vault.create.error.password_empty";
    case "password_mismatch":
      return "vault.create.password_mismatch";
    case "password_not_validated":
      return "vault.create.error.password_not_validated";
    case "password_wrong":
      return "error.wrong_password";
    default:
      return "vault.create.error.generic";
  }
}
