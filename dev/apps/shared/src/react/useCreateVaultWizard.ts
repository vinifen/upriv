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
  createEmptyCreateVaultDraft,
  createVaultImportNeedsArchivePassword,
  createVaultWizardInitialState,
  createVaultWizardReducer,
  isRpcError,
  MODAL_OPEN_MS,
  NO_VAULT_GROUPS,
  resolveCreateVaultCloseIntent,
  resolveCreateVaultFocusTarget,
  resolveCreateVaultOpenStep,
  selectCreateVaultWizardView,
  shouldBumpVaultRootEpoch,
  shouldSelectCreateVaultFocusText,
  VAULT_ERROR_CODES,
  type CreateVaultDraft,
  type EmbeddedSettingsSnapshot,
  type EmbeddedVaultSettings,
  type ImportZipClassification,
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
  testImportPassword: (
    password: string,
    importFile: { path: string; fileName: string; kind?: "file" | "backup" },
  ) => Promise<{ ok: boolean; embedded: EmbeddedVaultSettings | null }>;
  /** Classify a `.zip` and load store settings. A `.7z` does not carry settings. */
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

  const fieldRefs = useRef<Partial<Record<CreateVaultFocusField, TField>>>({});
  const lastFocusByStep = useRef<Partial<Record<CreateVaultStepId, CreateVaultFocusField>>>({});
  const visitedSteps = useRef<Set<CreateVaultStepId>>(new Set());
  const wasOpen = useRef(false);
  /** When true, first focus waits for the modal enter tween. */
  const deferFocusOnOpen = useRef(false);
  /** Invalidates in-flight import-password probes (unmount, reopen, re-test). */
  const passwordTestGen = useRef(0);
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
        passwordTestGen.current += 1;
        settingsGen.current += 1;
      }
    }
    wasOpen.current = open;
  }, [open, existingOrders, initialDraft, initialStep]);

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
        });
        if (classified.zipLayout === "store" && classified.embedded) {
          dispatch({
            type: "embeddedSettings",
            embedded: classified.embedded,
            snapshot: draft,
            existingDisplayNames: existingDisplayNamesRef.current,
          });
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
      passwordTestGen.current += 1;
      settingsGen.current += 1;
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
    if (!createVaultImportNeedsArchivePassword(state.draft)) return;
    const generation = (passwordTestGen.current += 1);
    dispatch({ type: "importPasswordTestStarted" });
    const password = state.draft.password;
    void (async () => {
      let ok = false;
      let embedded: EmbeddedVaultSettings | null = null;
      let unavailable = false;
      let timedOut = false;
      try {
        const probed = await testImportPassword(password, {
          path: state.draft.importFilePath,
          fileName: state.draft.importFileName,
          kind: state.draft.importKind,
        });
        ok = probed.ok;
        embedded = probed.embedded;
      } catch (error) {
        timedOut = isRpcError(error) && error.code === "rpc_timeout";
        unavailable = !(isRpcError(error) && error.code === VAULT_ERROR_CODES.WRONG_PASSWORD);
      }
      if (passwordTestGen.current !== generation) return;
      dispatch({ type: "importPasswordTestFinished", ok, unavailable });
      if (ok && embedded) {
        dispatch({
          type: "embeddedSettings",
          embedded,
          snapshot: settingsSnapshot.current ?? draftRef.current,
        });
      }
      // A timed-out probe can still finish in the daemon. Drop this generation
      // so a late callback cannot replace the timeout with success.
      if (timedOut) passwordTestGen.current += 1;
    })();
  }, [state.draft, testImportPassword]);

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
