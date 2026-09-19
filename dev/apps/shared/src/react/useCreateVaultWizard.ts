import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import {
  buildCreateVaultResult,
  canSubmitCreateVault,
  createEmptyCreateVaultDraft,
  createVaultWizardInitialState,
  createVaultWizardReducer,
  MODAL_OPEN_MS,
  NO_VAULT_GROUPS,
  resolveCreateVaultCloseIntent,
  resolveCreateVaultFocusTarget,
  resolveCreateVaultOpenStep,
  selectCreateVaultWizardView,
  shouldSelectCreateVaultFocusText,
  type CreateVaultDraft,
  type CreateVaultFocusField,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
} from "../domain";
import { scheduleAnimationFrame, scheduleTimeout } from "./schedule";

/** Web inputs expose `select()`; React Native `TextInput` only has `focus()`. */
export type CreateVaultFocusableField = {
  focus(): void;
  select?(): void;
};

export interface CreateVaultStepFocusProps<
  TField extends CreateVaultFocusableField = CreateVaultFocusableField,
> {
  onFieldFocus: (field: CreateVaultFocusField) => void;
  bindFieldRef: (field: CreateVaultFocusField) => (node: TField | null) => void;
  onAdvanceStep: () => void;
}

export interface UseCreateVaultWizardOptions {
  open: boolean;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  groups?: readonly VaultGroup[];
  /** Active vault-root path for reserved-mount checks on custom workspace paths. */
  vaultRootPath?: string | null;
  initialDraft?: CreateVaultDraft | null;
  initialStep?: CreateVaultStepId | null;
  /**
   * Enqueue create (list row + pipeline). Must throw synchronously to keep the
   * wizard open (import / duplicate id). Do not await Argon2 here.
   */
  onCreate: (result: CreateVaultResult, password: string) => void;
  onClose: () => void;
  testImportPassword: (password: string) => Promise<boolean>;
}

export function useCreateVaultWizard<
  TField extends CreateVaultFocusableField = CreateVaultFocusableField,
>({
  open,
  existingVaultIds,
  existingOrders,
  groups = NO_VAULT_GROUPS,
  vaultRootPath = null,
  initialDraft = null,
  initialStep = null,
  onCreate,
  onClose,
  testImportPassword,
}: UseCreateVaultWizardOptions) {
  const [state, dispatch] = useReducer(
    createVaultWizardReducer,
    existingOrders,
    createVaultWizardInitialState,
  );

  const context = useMemo(
    () => ({
      existingVaultIds,
      knownGroupIds: groups.map((group) => group.id),
      vaultRootPath,
    }),
    [existingVaultIds, groups, vaultRootPath],
  );
  const view = useMemo(() => selectCreateVaultWizardView(state, context), [state, context]);

  const fieldRefs = useRef<Partial<Record<CreateVaultFocusField, TField>>>({});
  const lastFocusByStep = useRef<Partial<Record<CreateVaultStepId, CreateVaultFocusField>>>({});
  const visitedSteps = useRef<Set<CreateVaultStepId>>(new Set());
  const wasOpen = useRef(false);
  /** When true, first focus waits for the modal enter tween. */
  const deferFocusOnOpen = useRef(false);
  /** Invalidates in-flight import-password probes (unmount, reopen, re-test). */
  const passwordTestGen = useRef(0);

  // Reset on the closed→open edge only: the vault list keeps refreshing while the
  // wizard is up, and reacting to those new arrays would wipe what the user typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      deferFocusOnOpen.current = true;
      dispatch({
        type: "opened",
        draft: initialDraft ?? createEmptyCreateVaultDraft(existingOrders),
        step: resolveCreateVaultOpenStep(initialDraft, initialStep),
      });
      fieldRefs.current = {};
      lastFocusByStep.current = {};
      visitedSteps.current = new Set();
      // A probe started in the previous session must not land on this draft.
      passwordTestGen.current += 1;
    }
    if (!open) deferFocusOnOpen.current = false;
    wasOpen.current = open;
  }, [open, existingOrders, initialDraft, initialStep]);

  useEffect(() => {
    return () => {
      passwordTestGen.current += 1;
    };
  }, []);

  const patchDraft = useCallback((patch: Partial<CreateVaultDraft>) => {
    dispatch({ type: "draftPatched", patch });
  }, []);

  const goToStep = useCallback((step: CreateVaultStepId) => {
    dispatch({ type: "stepSelected", step });
  }, []);

  const handleBack = useCallback(() => {
    dispatch({ type: "backRequested" });
  }, []);

  const handleNext = useCallback(() => {
    dispatch({ type: "nextRequested", context });
  }, [context]);

  const dismissFooterConfirm = useCallback(() => {
    dispatch({ type: "discardConfirmDismissed" });
  }, []);

  const handleTestImportPassword = useCallback(() => {
    const generation = (passwordTestGen.current += 1);
    dispatch({ type: "importPasswordTestStarted" });
    const password = state.draft.password;
    void (async () => {
      let ok = false;
      try {
        ok = await testImportPassword(password);
      } catch {
        ok = false;
      }
      if (passwordTestGen.current !== generation) return;
      dispatch({ type: "importPasswordTestFinished", ok });
    })();
  }, [state.draft.password, testImportPassword]);

  const handleClose = useCallback(() => {
    dispatch({ type: "closed" });
    onClose();
  }, [onClose]);

  const handleCreate = useCallback((): void => {
    dispatch({ type: "submitRequested" });
    // Decided from the draft, not from `view`: the render that produced `view`
    // predates this dispatch, so reading it would couple submit to render order.
    if (
      !canSubmitCreateVault(
        state.draft,
        existingVaultIds,
        context.knownGroupIds,
        context.vaultRootPath,
      )
    ) {
      return;
    }
    void onCreate(buildCreateVaultResult(state.draft, existingVaultIds), state.draft.password);
    handleClose();
  }, [
    state.draft,
    existingVaultIds,
    context.knownGroupIds,
    context.vaultRootPath,
    onCreate,
    handleClose,
  ]);

  const requestClose = useCallback(() => {
    switch (resolveCreateVaultCloseIntent(state)) {
      case "dismiss-confirm":
        dispatch({ type: "discardConfirmDismissed" });
        return;
      case "ask-confirm":
        dispatch({ type: "discardConfirmRequested" });
        return;
      case "close":
        handleClose();
    }
  }, [state, handleClose]);

  const handleDiscardAndClose = useCallback(() => {
    dispatch({ type: "draftDiscarded" });
    handleClose();
  }, [handleClose]);

  const onFieldFocus = useCallback(
    (field: CreateVaultFocusField) => {
      lastFocusByStep.current[state.currentStep] = field;
    },
    [state.currentStep],
  );

  const bindFieldRef = useCallback(
    (field: CreateVaultFocusField) => (node: TField | null) => {
      if (node) fieldRefs.current[field] = node;
      else delete fieldRefs.current[field];
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const step = state.currentStep;
    const target = resolveCreateVaultFocusTarget(
      step,
      lastFocusByStep.current[step],
      visitedSteps.current.has(step),
    );
    visitedSteps.current.add(step);
    if (!target) return;

    const focusField = () => {
      const field = fieldRefs.current[target];
      field?.focus();
      if (shouldSelectCreateVaultFocusText(target)) field?.select?.();
    };

    // Wait for the shared modal enter tween on first open; step changes focus ASAP.
    // `deferFocusOnOpen` is set in a useEffect that runs *after* this layout pass, so
    // also treat `!wasOpen` as the closed→open edge (and the follow-up after `opened`).
    const delay = deferFocusOnOpen.current || !wasOpen.current ? MODAL_OPEN_MS : 0;
    deferFocusOnOpen.current = false;
    if (delay <= 0) {
      return scheduleAnimationFrame(focusField);
    }
    let cancelFrame: (() => void) | undefined;
    const cancelTimeout = scheduleTimeout(() => {
      cancelFrame = scheduleAnimationFrame(focusField);
    }, delay);
    return () => {
      cancelTimeout();
      cancelFrame?.();
    };
  }, [open, state.currentStep]);

  return {
    draft: state.draft,
    currentStep: state.currentStep,
    testingPassword: state.testingPassword,
    discardConfirmOpen: state.discardConfirmOpen,
    ...view,
    patchDraft,
    goToStep,
    handleBack,
    handleNext,
    handleCreate,
    handleTestImportPassword,
    requestClose,
    handleDiscardAndClose,
    dismissFooterConfirm,
    stepFocus: { onFieldFocus, bindFieldRef, onAdvanceStep: handleNext },
    groups,
  };
}
