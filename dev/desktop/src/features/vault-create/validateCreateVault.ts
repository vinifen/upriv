import {
  displayNameToVaultId,
  validateDisplayName,
  type DisplayNameValidationCode,
} from "@/lib/vaultDisplayName";
import type {
  CreateVaultDraft,
  CreateVaultStepId,
  CreateVaultStepStatus,
} from "./createVaultTypes";

export type CreateVaultValidationCode =
  | DisplayNameValidationCode
  | "duplicate"
  | "source_missing"
  | "import_file_missing"
  | "password_empty"
  | "password_mismatch"
  | "password_not_validated"
  | "password_wrong";

export function vaultIdForDraft(draft: CreateVaultDraft, existingIds: readonly string[]): string {
  return displayNameToVaultId(draft.displayName, existingIds);
}

export function validateCreateVaultStep(
  stepId: CreateVaultStepId,
  draft: CreateVaultDraft,
  existingIds: readonly string[],
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
    case "general":
    case "advanced":
      return [];
    default:
      return [];
  }
}

export function validateAllCreateVaultSteps(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
): Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> {
  const result: Partial<Record<CreateVaultStepId, CreateVaultValidationCode[]>> = {};
  for (const stepId of ["source", "identity", "password", "general", "advanced"] as const) {
    const errors = validateCreateVaultStep(stepId, draft, existingIds);
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
): CreateVaultStepStatus {
  const errors = validateCreateVaultStep(stepId, draft, existingIds);
  if (errors.length === 0) return "ready";
  if (submitAttempted || visitedSteps.has(stepId)) return "error";
  return "incomplete";
}

export function canSubmitCreateVault(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
): boolean {
  return Object.keys(validateAllCreateVaultSteps(draft, existingIds)).length === 0;
}
