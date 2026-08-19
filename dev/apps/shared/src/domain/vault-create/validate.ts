import {
  displayNameToVaultId,
  validateDisplayName,
  type DisplayNameValidationCode,
} from "../vault/displayName";
import type { CreateVaultDraft, CreateVaultStepId, CreateVaultStepStatus } from "./types";

export type CreateVaultValidationCode =
  | DisplayNameValidationCode
  | "duplicate"
  | "source_missing"
  | "import_file_missing"
  | "password_empty"
  | "password_mismatch"
  | "password_not_validated"
  | "password_wrong"
  | "group_missing"
  | "group_name_empty"
  | "group_name_too_long"
  | "group_name_invalid";

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
): CreateVaultValidationCode[] {
  switch (stepId) {
    case "source": {
      const errors: CreateVaultValidationCode[] = [];
      if (!draft.source) errors.push("source_missing");
      if (draft.source === "import" && !draft.importFileName) errors.push("import_file_missing");
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
      if (!draft.password.trim()) errors.push("password_empty");
      if (draft.source === "scratch") {
        if (draft.password !== draft.passwordConfirm) errors.push("password_mismatch");
      } else if (draft.source === "import") {
        if (!draft.passwordValidated) {
          errors.push(draft.passwordTestFailed ? "password_wrong" : "password_not_validated");
        }
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
    case "advanced":
      return [];
    default:
      return [];
  }
}

export function validateAllCreateVaultSteps(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
): Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> {
  const result: Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> = {};
  for (const stepId of ["source", "identity", "password", "general", "advanced"] as const) {
    const errors = validateCreateVaultStep(stepId, draft, existingIds, knownGroupIds);
    if (errors.length > 0) result[stepId] = errors;
  }
  return result;
}

export function getCreateVaultStepStatus(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  visitedSteps: ReadonlySet<CreateVaultStepId>,
  submitAttempted: boolean,
  knownGroupIds: readonly string[] = [],
): CreateVaultStepStatus {
  const errors = validateCreateVaultStep(stepId, draft, existingIds, knownGroupIds);
  if (errors.length === 0) return "ready";
  if (submitAttempted || visitedSteps.has(stepId)) return "error";
  return "incomplete";
}

export function canSubmitCreateVault(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
  knownGroupIds: readonly string[] = [],
): boolean {
  return Object.keys(validateAllCreateVaultSteps(draft, existingIds, knownGroupIds)).length === 0;
}
