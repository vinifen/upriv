import { createEmptyCreateVaultDraft, createVaultDraftEqual } from "./defaults";
import { CREATE_VAULT_STEPS } from "./types";
import type { CreateVaultDraft, CreateVaultStepId, CreateVaultStepStatus } from "./types";
import {
  canSubmitCreateVault,
  getCreateVaultStepStatus,
  validateCreateVaultStep,
  type CreateVaultValidationCode,
} from "./validate";
import { shouldShowCreateVaultInlineErrors } from "./wizard";

/** Everything the wizard needs from the vault list to validate a draft. */
export interface CreateVaultWizardContext {
  existingVaultIds: readonly string[];
  knownGroupIds: readonly string[];
  /** Active vault-root path for reserved-mount checks on custom workspace paths. */
  vaultRootPath?: string | null;
}

export interface CreateVaultWizardState {
  /** Draft as it was when the wizard opened — restored on discard. */
  baseline: CreateVaultDraft;
  draft: CreateVaultDraft;
  currentStep: CreateVaultStepId;
  /** Steps the user tried to leave — gates inline errors and stepper badges. */
  attemptedSteps: ReadonlySet<CreateVaultStepId>;
  submitAttempted: boolean;
  testingPassword: boolean;
  discardConfirmOpen: boolean;
}

export type CreateVaultWizardAction =
  | { type: "opened"; draft: CreateVaultDraft; step: CreateVaultStepId }
  | { type: "draftPatched"; patch: Partial<CreateVaultDraft> }
  | { type: "stepSelected"; step: CreateVaultStepId }
  | { type: "backRequested" }
  | { type: "nextRequested"; context: CreateVaultWizardContext }
  | { type: "submitRequested" }
  | { type: "importPasswordTestStarted" }
  | { type: "importPasswordTestFinished"; ok: boolean }
  | { type: "discardConfirmRequested" }
  | { type: "discardConfirmDismissed" }
  | { type: "draftDiscarded" }
  | { type: "closed" };

export function createVaultWizardInitialState(
  existingOrders: readonly number[],
): CreateVaultWizardState {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  return {
    baseline: draft,
    draft,
    currentStep: "source",
    attemptedSteps: new Set(),
    submitAttempted: false,
    testingPassword: false,
    discardConfirmOpen: false,
  };
}

function withStep(
  steps: ReadonlySet<CreateVaultStepId>,
  stepId: CreateVaultStepId,
): ReadonlySet<CreateVaultStepId> {
  return new Set(steps).add(stepId);
}

function stepAt(offset: number, from: CreateVaultStepId): CreateVaultStepId | null {
  const index = CREATE_VAULT_STEPS.indexOf(from) + offset;
  return CREATE_VAULT_STEPS[index] ?? null;
}

export function createVaultWizardReducer(
  state: CreateVaultWizardState,
  action: CreateVaultWizardAction,
): CreateVaultWizardState {
  switch (action.type) {
    case "opened":
      return {
        baseline: action.draft,
        draft: action.draft,
        currentStep: action.step,
        attemptedSteps: new Set(),
        submitAttempted: false,
        testingPassword: false,
        discardConfirmOpen: false,
      };

    case "draftPatched":
      return {
        ...state,
        draft: { ...state.draft, ...action.patch },
        discardConfirmOpen: false,
      };

    case "stepSelected":
      return { ...state, currentStep: action.step, discardConfirmOpen: false };

    case "backRequested": {
      const previous = stepAt(-1, state.currentStep);
      if (!previous) return state;
      return { ...state, currentStep: previous, discardConfirmOpen: false };
    }

    case "nextRequested": {
      const attemptedSteps = withStep(state.attemptedSteps, state.currentStep);
      const errors = validateCreateVaultStep(
        state.currentStep,
        state.draft,
        action.context.existingVaultIds,
        action.context.knownGroupIds,
        action.context.vaultRootPath,
      );
      if (errors.length > 0) return { ...state, attemptedSteps };
      const next = stepAt(1, state.currentStep);
      if (!next) return { ...state, attemptedSteps };
      return { ...state, attemptedSteps, currentStep: next, discardConfirmOpen: false };
    }

    case "submitRequested":
      return {
        ...state,
        submitAttempted: true,
        attemptedSteps: new Set(CREATE_VAULT_STEPS),
      };

    case "importPasswordTestStarted":
      return { ...state, testingPassword: true };

    // Leaves `discardConfirmOpen` alone: an async probe answering is not the
    // user answering the close prompt they opened while it was in flight.
    case "importPasswordTestFinished":
      return {
        ...state,
        testingPassword: false,
        draft: {
          ...state.draft,
          passwordValidated: action.ok,
          passwordTestFailed: !action.ok,
        },
      };

    case "discardConfirmRequested":
      return { ...state, discardConfirmOpen: true };

    case "discardConfirmDismissed":
      return { ...state, discardConfirmOpen: false };

    case "draftDiscarded":
      return { ...state, draft: state.baseline, discardConfirmOpen: false };

    case "closed":
      return { ...state, discardConfirmOpen: false, submitAttempted: false };

    default:
      return state;
  }
}

/** What a close request should do next, given unsaved edits and the footer confirm. */
export type CreateVaultCloseIntent = "dismiss-confirm" | "ask-confirm" | "close";

export function resolveCreateVaultCloseIntent(
  state: CreateVaultWizardState,
): CreateVaultCloseIntent {
  if (state.discardConfirmOpen) return "dismiss-confirm";
  if (!createVaultDraftEqual(state.draft, state.baseline)) return "ask-confirm";
  return "close";
}

/** Values derived from state — recomputed on every render, never stored. */
export interface CreateVaultWizardView {
  stepStatuses: Record<CreateVaultStepId, CreateVaultStepStatus>;
  inlineErrors: readonly CreateVaultValidationCode[];
  isFirstStep: boolean;
  isLastStep: boolean;
  canCreate: boolean;
  isDirty: boolean;
}

export function selectCreateVaultWizardView(
  state: CreateVaultWizardState,
  context: CreateVaultWizardContext,
): CreateVaultWizardView {
  const { existingVaultIds, knownGroupIds, vaultRootPath } = context;
  const stepStatuses = {} as Record<CreateVaultStepId, CreateVaultStepStatus>;
  for (const stepId of CREATE_VAULT_STEPS) {
    stepStatuses[stepId] = getCreateVaultStepStatus(
      stepId,
      state.draft,
      existingVaultIds,
      state.attemptedSteps,
      state.submitAttempted,
      knownGroupIds,
      vaultRootPath,
    );
  }

  const showErrors = shouldShowCreateVaultInlineErrors(
    state.currentStep,
    state.attemptedSteps,
    state.submitAttempted,
  );

  return {
    stepStatuses,
    inlineErrors: showErrors
      ? validateCreateVaultStep(
          state.currentStep,
          state.draft,
          existingVaultIds,
          knownGroupIds,
          vaultRootPath,
        )
      : [],
    isFirstStep: state.currentStep === CREATE_VAULT_STEPS[0],
    isLastStep: state.currentStep === CREATE_VAULT_STEPS[CREATE_VAULT_STEPS.length - 1],
    canCreate: canSubmitCreateVault(state.draft, existingVaultIds, knownGroupIds, vaultRootPath),
    isDirty: !createVaultDraftEqual(state.draft, state.baseline),
  };
}
