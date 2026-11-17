import type { CreateVaultValidationCode } from "./validate";

export type CreateVaultErrorField =
  | "source"
  | "displayName"
  | "password"
  | "passwordConfirm"
  | "group"
  | "groupName"
  | "unlockedFolder"
  | "backupFolder"
  | "storage";

const FIELD_CODES: Record<CreateVaultErrorField, readonly CreateVaultValidationCode[]> = {
  source: ["source_missing", "import_file_missing", "import_zip_pending", "import_zip_rejected"],
  displayName: ["empty", "invalid_chars", "trailing", "reserved", "too_long", "duplicate"],
  password: [
    "password_empty",
    "password_not_validated",
    "password_wrong",
    "import_probe_unavailable",
  ],
  passwordConfirm: ["password_mismatch"],
  group: ["group_missing"],
  groupName: ["group_name_empty", "group_name_too_long", "group_name_invalid"],
  storage: [],
  unlockedFolder: ["unlocked_folder_row_invalid", "unlocked_folder_unchosen"],
  backupFolder: ["backup_folder_row_invalid"],
};

/** Codes that belong under a specific control — never invent extras. */
export function createVaultErrorsForField(
  errors: readonly CreateVaultValidationCode[],
  field: CreateVaultErrorField,
): CreateVaultValidationCode[] {
  const allowed = new Set<CreateVaultValidationCode>(FIELD_CODES[field]);
  return errors.filter((code) => allowed.has(code));
}
