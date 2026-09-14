import type { CreateVaultValidationCode } from "./validate";

export type CreateVaultErrorField =
  | "source"
  | "displayName"
  | "password"
  | "passwordConfirm"
  | "group"
  | "groupName"
  | "mount"
  | "storage";

const FIELD_CODES: Record<CreateVaultErrorField, readonly CreateVaultValidationCode[]> = {
  source: ["source_missing", "import_file_missing", "import_not_available"],
  displayName: ["empty", "invalid_chars", "trailing", "reserved", "too_long", "duplicate"],
  password: ["password_empty", "password_too_short", "password_not_validated", "password_wrong"],
  passwordConfirm: ["password_mismatch"],
  group: ["group_missing"],
  groupName: ["group_name_empty", "group_name_too_long", "group_name_invalid"],
  storage: ["plain_not_available"],
  mount: [
    "mount_path_empty",
    "mount_path_not_absolute",
    "mount_path_saf_tree",
    "mount_path_reserved",
    "mount_path_root_unknown",
  ],
};

/** Codes that belong under a specific control — never invent extras. */
export function createVaultErrorsForField(
  errors: readonly CreateVaultValidationCode[],
  field: CreateVaultErrorField,
): CreateVaultValidationCode[] {
  const allowed = new Set<CreateVaultValidationCode>(FIELD_CODES[field]);
  return errors.filter((code) => allowed.has(code));
}
