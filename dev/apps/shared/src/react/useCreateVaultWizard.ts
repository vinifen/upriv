import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  buildCreateVaultResult,
  canSubmitCreateVault,
  CREATE_VAULT_STEPS,
  createEmptyCreateVaultDraft,
  createVaultImportNeedsArchivePassword,
  createVaultSetsPassword,
  createVaultWizardInitialState,
  createVaultWizardReducer,
  firstInvalidCreateVaultField,
  isJobCancelled,
  isRpcError,
  MODAL_OPEN_MS,
  newJobId,
  NO_VAULT_GROUPS,
  ROW_ROLE_GUARD_MS,
  resolveCreateVaultCloseIntent,
  resolveCreateVaultFocusTarget,
  resolveCreateVaultNextKeyField,
  resolveCreateVaultOpenStep,
  selectCreateVaultWizardView,
  shouldBumpVaultRootEpoch,
  shouldSelectCreateVaultFocusText,
  validateCreateVaultStep,
  VAULT_ERROR_CODES,
  vaultPublicText,
  type CreateVaultDraft,
  type EmbeddedSettingsSnapshot,
  type EmbeddedVaultSettings,
  type ImportZipClassification,
  type CreateVaultFocusField,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
} from "../domain";
import type { ImportPackageProbe } from "../services/vault-create/CreateVaultService";
import { scheduleAnimationFrame, scheduleTimeout } from "./schedule";
import { usePasswordWeakness } from "./usePasswordWeakness";

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
  /** Keyboard Next / Enter on a field: next invalid field, else the step's Next. */
  onFieldSubmit: (field: CreateVaultFocusField) => void;
}

export interface UseCreateVaultWizardOptions {
  open: boolean;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  /** Display names already on the vault list, for ` N` and ` backup` suggestions. */
  existingDisplayNames?: readonly string[];
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
  /** A `.7z` test runs as the core job `job`; it has no time limit, and Stop ends it. */
  testImportPassword: (
    password: string,
    importFile: { path: string; fileName: string; kind?: "file" | "backup" },
    job: string,
  ) => Promise<ImportPackageProbe>;
  /** Ask core to stop the job `job` (`job_cancel`). */
  stopJob: (job: string) => Promise<void>;
  /** Classify a `.zip` and load the settings it carries. A `.7z` waits for its password. */
  readImportPackageSettings?: (importFile: {
    path: string;
    fileName: string;
    kind?: "file" | "backup";
  }) => Promise<ImportZipClassification | null>;
  /** Missing or incomplete vault-root. Does not mark the zip as rejected. */
  onVaultRootFailure?: (error: unknown) => void;
}

export function useCreateVaultWizard<
  TField extends CreateVaultFocusableField = CreateVaultFocusableField,
>({
  open,
  existingVaultIds,
  existingOrders,
  existingDisplayNames = [],
  groups = NO_VAULT_GROUPS,
  vaultRootPath = null,
  initialDraft = null,
  initialStep = null,
  onCreate,
  onClose,
  testImportPassword,
  stopJob,
  readImportPackageSettings,
  onVaultRootFailure,
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

  const setsPassword = createVaultSetsPassword(state.draft);
  const { password, displayName, passwordHint, note } = state.draft;
  const vaultText = useMemo(
    () => vaultPublicText({ displayName, passwordHint, note }),
    [displayName, passwordHint, note],
  );
  const passwordWeakness = usePasswordWeakness(setsPassword ? password : "", vaultText);
  /** When the footer notice appeared: the second half of a double click must not answer it. */
  const weaknessNoticeAt = useRef(0);

  const fieldRefs = useRef<Partial<Record<CreateVaultFocusField, TField>>>({});
  const lastFocusByStep = useRef<Partial<Record<CreateVaultStepId, CreateVaultFocusField>>>({});
  const visitedSteps = useRef<Set<CreateVaultStepId>>(new Set());
  /** Focus chosen by a keyboard Next that advanced the step (null = no field needs input). */
  const pendingStepFocus = useRef<{
    step: CreateVaultStepId;
    field: CreateVaultFocusField | null;
  } | null>(null);
  const wasOpen = useRef(false);
  /** When true, first focus waits for the modal enter tween. */
  const deferFocusOnOpen = useRef(false);
  /** Invalidates in-flight import-password probes (unmount, reopen, re-test). */
  const passwordTestGen = useRef(0);
  /** The core job of the `.7z` test in flight. */
  const passwordTestJob = useRef<string | null>(null);
  /** When the test in flight was sent; the step counts from here. */
  const [passwordTestStartedAt, setPasswordTestStartedAt] = useState<number | null>(null);
  const stopJobRef = useRef(stopJob);
  stopJobRef.current = stopJob;
  /** A test nobody waits for any more (closed wizard) must not keep the import lane. */
  const dropPasswordTest = useCallback(() => {
    passwordTestGen.current += 1;
    const job = passwordTestJob.current;
    passwordTestJob.current = null;
    if (job) void stopJobRef.current(job).catch(() => undefined);
  }, []);
  const existingDisplayNamesRef = useRef(existingDisplayNames);
  existingDisplayNamesRef.current = existingDisplayNames;
  /** Draft when the import path was chosen, before embedded settings replace untouched fields. */
  const settingsSnapshot = useRef<EmbeddedSettingsSnapshot | null>(null);
  const settingsPath = useRef<string | null>(null);
  const settingsGen = useRef(0);
  /** One number per open. The settings effect waits until this visit's draft is in state. */
  const [visit, setVisit] = useState(0);
  /** False for the render that still shows the previous visit, until `opened` lands. */
  const acceptSettings = useRef(true);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  // Reset on the closed→open edge only: the vault list keeps refreshing while the
  // wizard is up, and reacting to those new arrays would wipe what the user typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      deferFocusOnOpen.current = true;
      acceptSettings.current = false;
      setVisit((current) => current + 1);
      dispatch({
        type: "opened",
        draft: initialDraft ?? createEmptyCreateVaultDraft(existingOrders),
        step: resolveCreateVaultOpenStep(initialDraft, initialStep),
      });
      fieldRefs.current = {};
      lastFocusByStep.current = {};
      visitedSteps.current = new Set();
      pendingStepFocus.current = null;
      settingsSnapshot.current = null;
      settingsPath.current = null;
      passwordTestGen.current += 1;
      settingsGen.current += 1;
    }
    if (!open) {
      deferFocusOnOpen.current = false;
      if (wasOpen.current) {
        settingsSnapshot.current = null;
        settingsPath.current = null;
        dropPasswordTest();
        settingsGen.current += 1;
        dispatch({ type: "closed" });
      }
    }
    wasOpen.current = open;
  }, [open, existingOrders, initialDraft, initialStep, dropPasswordTest]);

  useEffect(() => {
    if (!acceptSettings.current) {
      acceptSettings.current = true;
      return;
    }
    if (!open || !readImportPackageSettings || visit === 0) return;
    const path = state.draft.importFilePath.trim();
    if (!path || settingsPath.current === path) return;
    const draft = draftRef.current;
    settingsPath.current = path;
    settingsSnapshot.current = draft;
    if (draft.source !== "import") return;
    const isZip =
      draft.importShape !== "directory" &&
      (draft.importKind === "backup" || draft.importFileName.toLowerCase().endsWith(".zip"));
    if (!isZip) return;
    const generation = (settingsGen.current += 1);
    void readImportPackageSettings({
      path,
      fileName: draft.importFileName,
      kind: draft.importKind,
    })
      .then((classified) => {
        if (settingsGen.current !== generation) return;
        if (!classified) {
          dispatch({ type: "zipClassified", zipLayout: null, rejected: true });
          return;
        }
        dispatch({
          type: "zipClassified",
          zipLayout: classified.zipLayout,
          rejected: false,
          carriesWorkspace: classified.carriesWorkspace,
        });
        if (classified.vaultName) {
          dispatch({
            type: "vaultNamed",
            vaultName: classified.vaultName,
            snapshot: draft,
            existingDisplayNames: existingDisplayNamesRef.current,
          });
        }
        if (classified.embedded) {
          dispatch({ type: "embeddedSettings", embedded: classified.embedded, snapshot: draft });
        }
      })
      .catch((error: unknown) => {
        if (settingsGen.current !== generation) return;
        if (shouldBumpVaultRootEpoch(error)) {
          onVaultRootFailure?.(error);
          return;
        }
        dispatch({
          type: "zipClassified",
          zipLayout: null,
          rejected: false,
          probeFailed: true,
        });
      });
  }, [
    open,
    visit,
    readImportPackageSettings,
    state.draft.importFilePath,
    state.draft.importFileName,
    state.draft.importKind,
    state.draft.importShape,
    onVaultRootFailure,
  ]);

  useEffect(() => {
    return () => {
      dropPasswordTest();
      settingsGen.current += 1;
    };
  }, [dropPasswordTest]);

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
    dispatch({ type: "footerMessageDismissed" });
  }, []);

  const handleTestImportPassword = useCallback(() => {
    if (!createVaultImportNeedsArchivePassword(state.draft)) return;
    const generation = (passwordTestGen.current += 1);
    dispatch({ type: "importPasswordTestStarted" });
    const password = state.draft.password;
    const job = newJobId();
    passwordTestJob.current = job;
    setPasswordTestStartedAt(Date.now());
    void (async () => {
      let ok = false;
      let embedded: EmbeddedVaultSettings | null = null;
      let vaultName: string | null = null;
      let unavailable = false;
      let stopped = false;
      try {
        const probed = await testImportPassword(
          password,
          {
            path: state.draft.importFilePath,
            fileName: state.draft.importFileName,
            kind: state.draft.importKind,
          },
          job,
        );
        ok = probed.ok;
        embedded = probed.embedded;
        vaultName = probed.vaultName;
      } catch (error) {
        stopped = isJobCancelled(error);
        unavailable = !(isRpcError(error) && error.code === VAULT_ERROR_CODES.WRONG_PASSWORD);
      }
      if (passwordTestJob.current === job) passwordTestJob.current = null;
      if (passwordTestGen.current !== generation) return;
      setPasswordTestStartedAt(null);
      if (stopped) {
        dispatch({ type: "importPasswordTestStopped" });
        return;
      }
      dispatch({ type: "importPasswordTestFinished", ok, unavailable });
      if (!ok) return;
      const snapshot = settingsSnapshot.current ?? draftRef.current;
      if (vaultName) {
        dispatch({
          type: "vaultNamed",
          vaultName,
          snapshot,
          existingDisplayNames: existingDisplayNamesRef.current,
        });
      }
      if (embedded) dispatch({ type: "embeddedSettings", embedded, snapshot });
    })();
  }, [state.draft, testImportPassword]);

  /** Stop the `.7z` test in flight. Its own call ends it, with nothing marked or filled. */
  const stopTestImportPassword = useCallback(() => {
    const job = passwordTestJob.current;
    if (job) void stopJob(job).catch(() => undefined);
  }, [stopJob]);

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
    if (passwordWeakness !== null) {
      // The window closes on create, so a press without the notice only brings it up.
      if (!state.weaknessNoticeOpen) {
        weaknessNoticeAt.current = Date.now();
        dispatch({ type: "weaknessNoticeRequested" });
        return;
      }
      if (Date.now() - weaknessNoticeAt.current < ROW_ROLE_GUARD_MS) return;
    }
    void onCreate(buildCreateVaultResult(state.draft, existingVaultIds), state.draft.password);
    handleClose();
  }, [
    state.draft,
    state.weaknessNoticeOpen,
    passwordWeakness,
    existingVaultIds,
    context.knownGroupIds,
    context.vaultRootPath,
    onCreate,
    handleClose,
  ]);

  const requestClose = useCallback(() => {
    switch (resolveCreateVaultCloseIntent(state)) {
      case "dismiss-confirm":
        dispatch({ type: "footerMessageDismissed" });
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

  const focusField = useCallback((field: CreateVaultFocusField) => {
    const node = fieldRefs.current[field];
    node?.focus();
    if (shouldSelectCreateVaultFocusText(field)) node?.select?.();
  }, []);

  const onFieldSubmit = useCallback(
    (field: CreateVaultFocusField) => {
      const validate = (step: CreateVaultStepId) =>
        validateCreateVaultStep(
          step,
          state.draft,
          context.existingVaultIds,
          context.knownGroupIds,
          context.vaultRootPath,
        );
      const step = state.currentStep;
      const errors = validate(step);
      const target = resolveCreateVaultNextKeyField(step, field, errors);
      if (target) {
        focusField(target);
        return;
      }
      const nextStep = CREATE_VAULT_STEPS[CREATE_VAULT_STEPS.indexOf(step) + 1];
      if (errors.length === 0 && nextStep) {
        pendingStepFocus.current = {
          step: nextStep,
          field: firstInvalidCreateVaultField(nextStep, validate(nextStep)),
        };
      }
      dispatch({ type: "nextRequested", context });
    },
    [context, focusField, state.currentStep, state.draft],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const step = state.currentStep;
    const pending = pendingStepFocus.current;
    pendingStepFocus.current = null;
    const target =
      pending?.step === step
        ? pending.field
        : resolveCreateVaultFocusTarget(
            step,
            lastFocusByStep.current[step],
            visitedSteps.current.has(step),
          );
    visitedSteps.current.add(step);
    if (!target) return;

    const focusTarget = () => focusField(target);

    // Wait for the shared modal enter tween on first open; step changes focus ASAP.
    // `deferFocusOnOpen` is set in a useEffect that runs *after* this layout pass, so
    // also treat `!wasOpen` as the closed→open edge (and the follow-up after `opened`).
    const delay = deferFocusOnOpen.current || !wasOpen.current ? MODAL_OPEN_MS : 0;
    deferFocusOnOpen.current = false;
    if (delay <= 0) {
      return scheduleAnimationFrame(focusTarget);
    }
    let cancelFrame: (() => void) | undefined;
    const cancelTimeout = scheduleTimeout(() => {
      cancelFrame = scheduleAnimationFrame(focusTarget);
    }, delay);
    return () => {
      cancelTimeout();
      cancelFrame?.();
    };
  }, [focusField, open, state.currentStep]);

  return {
    draft: state.draft,
    currentStep: state.currentStep,
    testingPassword: state.testingPassword,
    passwordTestStartedAt: state.testingPassword ? passwordTestStartedAt : null,
    discardConfirmOpen: state.discardConfirmOpen,
    /** What is wrong with the new password, `null` when nothing is or this draft sets none. */
    passwordWeakness,
    /** The same, for the footer: from a press on Create until the next interaction. */
    footerPasswordWeakness: state.weaknessNoticeOpen ? passwordWeakness : null,
    ...view,
    patchDraft,
    goToStep,
    handleBack,
    handleNext,
    handleCreate,
    handleTestImportPassword,
    stopTestImportPassword,
    requestClose,
    handleDiscardAndClose,
    dismissFooterConfirm,
    stepFocus: { onFieldFocus, bindFieldRef, onFieldSubmit },
    groups,
  };
}
