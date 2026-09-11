import type { CreateVaultDraft, CreateVaultStepId } from "./types";

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
