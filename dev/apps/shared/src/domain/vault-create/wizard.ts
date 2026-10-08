import { createVaultErrorsForField, type CreateVaultErrorField } from "./fieldErrors";
import type { CreateVaultDraft, CreateVaultStepId } from "./types";
import type { CreateVaultValidationCode } from "./validate";

/** Focusable fields tracked across step navigation in the create-vault wizard. */
export type CreateVaultFocusField =
  "displayName" | "note" | "password" | "passwordConfirm" | "passwordHint";

export const CREATE_VAULT_DEFAULT_FOCUS: Partial<Record<CreateVaultStepId, CreateVaultFocusField>> =
  {
    identity: "displayName",
    password: "password",
  };

export function resolveCreateVaultOpenStep(
  initialDraft: CreateVaultDraft | null | undefined,
  initialStep: CreateVaultStepId | null | undefined,
): CreateVaultStepId {
  if (initialStep) return initialStep;
  if (initialDraft) return "identity";
  return "source";
}

export function shouldShowCreateVaultInlineErrors(
  stepId: CreateVaultStepId,
  attemptedSteps: ReadonlySet<CreateVaultStepId>,
  submitAttempted: boolean,
): boolean {
  return submitAttempted || attemptedSteps.has(stepId);
}

/**
 * Which field to focus when a step is shown: where the user left off, or the
 * step default on first visit only — returning to a step must not steal focus.
 */
export function resolveCreateVaultFocusTarget(
  stepId: CreateVaultStepId,
  lastFocused: CreateVaultFocusField | undefined,
  visitedBefore: boolean,
): CreateVaultFocusField | null {
  if (lastFocused) return lastFocused;
  if (visitedBefore) return null;
  return CREATE_VAULT_DEFAULT_FOCUS[stepId] ?? null;
}

/** Text fields whose current value should be selected when focused. */
export function shouldSelectCreateVaultFocusText(field: CreateVaultFocusField): boolean {
  return field === "displayName";
}

/** Text fields of each step, in screen order. */
const CREATE_VAULT_STEP_FIELDS: Partial<
  Record<CreateVaultStepId, readonly CreateVaultFocusField[]>
> = {
  identity: ["displayName", "note"],
  password: ["password", "passwordConfirm", "passwordHint"],
};

/** Fields that can hold a validation error. `note` and `passwordHint` are optional. */
const CREATE_VAULT_FIELD_ERRORS: Partial<Record<CreateVaultFocusField, CreateVaultErrorField>> = {
  displayName: "displayName",
  password: "password",
  passwordConfirm: "passwordConfirm",
};

function isCreateVaultFieldInvalid(
  field: CreateVaultFocusField,
  errors: readonly CreateVaultValidationCode[],
): boolean {
  const errorField = CREATE_VAULT_FIELD_ERRORS[field];
  return errorField !== undefined && createVaultErrorsForField(errors, errorField).length > 0;
}

/** First field on the step that still has an error, or null when every field is valid. */
export function firstInvalidCreateVaultField(
  stepId: CreateVaultStepId,
  errors: readonly CreateVaultValidationCode[],
): CreateVaultFocusField | null {
  const fields = CREATE_VAULT_STEP_FIELDS[stepId] ?? [];
  return fields.find((field) => isCreateVaultFieldInvalid(field, errors)) ?? null;
}

/**
 * Keyboard Next / Enter on `field` (`errors` = the current step's validation).
 * Returns the next field on the step that still has an error; valid fields are
 * skipped. Null means run the step's Next: it advances when the step is valid,
 * or stays and shows the errors when `field` itself is invalid.
 */
export function resolveCreateVaultNextKeyField(
  stepId: CreateVaultStepId,
  field: CreateVaultFocusField,
  errors: readonly CreateVaultValidationCode[],
): CreateVaultFocusField | null {
  if (isCreateVaultFieldInvalid(field, errors)) return null;
  const fields = CREATE_VAULT_STEP_FIELDS[stepId] ?? [];
  const at = fields.indexOf(field);
  const after = [...fields.slice(at + 1), ...fields.slice(0, Math.max(at, 0))];
  return after.find((next) => isCreateVaultFieldInvalid(next, errors)) ?? null;
}
