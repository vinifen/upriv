import {
  displayNameToVaultId,
  validateDisplayName,
  type DisplayNameValidationCode,
} from "../vault/displayName";
import {
  isAbsoluteFilesystemPath,
  isAbsoluteOsFilesystemPath,
  isReservedUprivWorkspacePath,
  normalizeMountWorkspacePath,
  safTreeUriHasExtraSegment,
  WORKSPACE_PATH_DEFAULT,
} from "../workspace";
import type { CreateVaultDraft, CreateVaultStepId, CreateVaultStepStatus } from "./types";
import { createVaultImportNeedsArchivePassword } from "./importKind";

export type CreateVaultValidationCode =
  | DisplayNameValidationCode
  | "duplicate"
  | "source_missing"
  | "import_file_missing"
  | "password_empty"
  | "password_too_short"
  | "password_mismatch"
  | "password_not_validated"
  | "password_wrong"
  | "import_probe_unavailable"
  | "group_missing"
  | "group_name_empty"
  | "group_name_too_long"
  | "group_name_invalid"
  | "mount_path_empty"
  | "mount_path_not_absolute"
  | "mount_path_saf_tree"
  | "mount_path_reserved"
  | "mount_path_root_unknown"
  | "plain_not_available";

/** Mock lifecycle unlock (`trim().length >= 4`). Live create/open only reject empty. */
export const CREATE_VAULT_PASSWORD_MIN_LENGTH = 4;

/** Mock unlock / rewrap reject this word. Live create does not. */
const MOCK_LIFECYCLE_WRONG_PASSWORD = "wrong";

/** Prototype mock unlock — still trims. Not used on live create. */
export function isMockLifecyclePasswordValid(password: string): boolean {
  const trimmed = password.trim();
  if (!trimmed) return false;
  if (trimmed.length < CREATE_VAULT_PASSWORD_MIN_LENGTH) return false;
  return trimmed !== MOCK_LIFECYCLE_WRONG_PASSWORD;
}

/**
 * Live unlock / close prompt: trim only to detect an empty field.
 * Argon2 receives the password bytes exactly as typed.
 */
export function isLifecyclePasswordPresent(password: string): boolean {
  return password.trim().length > 0;
}

export function vaultIdForCreateDraft(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
): string {
  return displayNameToVaultId(draft.displayName, existingIds);
}

export function validateCreateVaultStep(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  /** When set, `existing` group assignment must reference a live group id. */
  knownGroupIds: readonly string[] = [],
  vaultRootPath?: string | null,
): CreateVaultValidationCode[] {
  switch (stepId) {
    case "source": {
      const errors: CreateVaultValidationCode[] = [];
      if (!draft.source) errors.push("source_missing");
      if (draft.source === "import") {
        if (draft.importKind === "backup") {
          if (!draft.importFilePath.trim()) errors.push("import_file_missing");
        } else if (
          !draft.importFileName.trim() ||
          !isAbsoluteOsFilesystemPath(draft.importFilePath)
        ) {
          errors.push("import_file_missing");
        }
      }
      return errors;
    }
    case "identity": {
      const errors: CreateVaultValidationCode[] = [];
      const nameError = validateDisplayName(draft.displayName);
      if (nameError) errors.push(nameError);
      const nextId = displayNameToVaultId(draft.displayName, []);
      if (draft.displayName.trim() && existingIds.includes(nextId)) errors.push("duplicate");
      return errors;
    }
    case "password": {
      const errors: CreateVaultValidationCode[] = [];
      const password = draft.password;
      if (draft.source === "scratch") {
        if (!password.trim()) errors.push("password_empty");
        if (draft.password !== draft.passwordConfirm) errors.push("password_mismatch");
      } else if (draft.source === "import") {
        if (createVaultImportNeedsArchivePassword(draft)) {
          if (!password.trim()) errors.push("password_empty");
          if (draft.passwordProbeUnavailable) {
            errors.push("import_probe_unavailable");
          } else if (!draft.passwordValidated) {
            if (draft.passwordTestFailed) {
              if (!errors.includes("password_wrong")) errors.push("password_wrong");
            } else {
              errors.push("password_not_validated");
            }
          }
        }
      } else if (!password.trim()) {
        errors.push("password_empty");
      }
      return errors;
    }
    case "general": {
      const errors: CreateVaultValidationCode[] = [];
      if (draft.groupMode === "existing") {
        const groupId = draft.groupId.trim();
        if (!groupId || !knownGroupIds.includes(groupId)) {
          errors.push("group_missing");
        }
      }
      if (draft.groupMode === "create") {
        const nameError = validateDisplayName(draft.groupName);
        if (nameError === "empty") errors.push("group_name_empty");
        else if (nameError === "too_long") errors.push("group_name_too_long");
        else if (nameError) errors.push("group_name_invalid");
      }
      return errors;
    }
    case "advanced": {
      const errors: CreateVaultValidationCode[] = [];
      if (draft.storage.mode === "upriv_plain") errors.push("plain_not_available");
      // Empty = UI "custom incomplete" (normalizeMount would coerce to "default").
      const raw = draft.mount.workspace_path.trim();
      if (raw === "") {
        errors.push("mount_path_empty");
        return errors;
      }
      const normalized = normalizeMountWorkspacePath(raw);
      if (normalized === WORKSPACE_PATH_DEFAULT) {
        return errors;
      }
      if (!isAbsoluteFilesystemPath(normalized)) {
        errors.push("mount_path_not_absolute");
        return errors;
      }
      if (safTreeUriHasExtraSegment(normalized)) {
        errors.push("mount_path_saf_tree");
        return errors;
      }
      // Fail closed: cannot prove reserved-safety without a known vault-root.
      const root = typeof vaultRootPath === "string" ? vaultRootPath.trim() : "";
      if (!root) {
        errors.push("mount_path_root_unknown");
        return errors;
      }
      if (isReservedUprivWorkspacePath(normalized, root)) {
        errors.push("mount_path_reserved");
      }
      return errors;
    }
    default:
      return [];
  }
}

export function validateAllCreateVaultSteps(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
  vaultRootPath?: string | null,
): Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> {
  const result: Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> = {};
  for (const stepId of ["source", "identity", "password", "general", "advanced"] as const) {
    const errors = validateCreateVaultStep(
      stepId,
      draft,
      existingIds,
      knownGroupIds,
      vaultRootPath,
    );
    if (errors.length > 0) result[stepId] = errors;
  }
  return result;
}

export function getCreateVaultStepStatus(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  attemptedSteps: ReadonlySet<CreateVaultStepId>,
  submitAttempted: boolean,
  knownGroupIds: readonly string[] = [],
  vaultRootPath?: string | null,
): CreateVaultStepStatus {
  const errors = validateCreateVaultStep(stepId, draft, existingIds, knownGroupIds, vaultRootPath);
  if (errors.length === 0) return "ready";
  if (submitAttempted || attemptedSteps.has(stepId)) return "error";
  return "incomplete";
}

export function canSubmitCreateVault(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
  vaultRootPath?: string | null,
): boolean {
  return (
    Object.keys(validateAllCreateVaultSteps(draft, existingIds, knownGroupIds, vaultRootPath))
      .length === 0
  );
}
