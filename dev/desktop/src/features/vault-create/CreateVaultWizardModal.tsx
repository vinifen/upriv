import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { buildCreateVaultResult } from "./buildCreateVaultResult";
import { createEmptyDraft, createVaultDraftEqual } from "./createVaultDefaults";
import { CreateVaultStepNav } from "./CreateVaultStepNav";
import { renderCreateVaultStep } from "./createVaultForm";
import { mockTestArchivePassword } from "./mockImportArchive";
import {
  CREATE_VAULT_STEPS,
  type CreateVaultResult,
  type CreateVaultStepId,
  type CreateVaultStepStatus,
} from "./createVaultTypes";
import type { CreateVaultDraft } from "./createVaultTypes";
import {
  canSubmitCreateVault,
  getCreateVaultStepStatus,
  validateCreateVaultStep,
} from "./validateCreateVault";

interface CreateVaultWizardModalProps {
  open: boolean;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  /** Pre-filled draft (e.g. import from a backup row). Skips source step. */
  initialDraft?: CreateVaultDraft | null;
  onClose: () => void;
  onCreate: (result: CreateVaultResult) => void;
}

export function CreateVaultWizardModal({
  open,
  existingVaultIds,
  existingOrders,
  initialDraft = null,
  onClose,
  onCreate,
}: CreateVaultWizardModalProps) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = useState<CreateVaultDraft>(() => createEmptyDraft(existingOrders));
  const [draft, setDraft] = useState<CreateVaultDraft>(() => createEmptyDraft(existingOrders));
  const [currentStep, setCurrentStep] = useState<CreateVaultStepId>("source");
  const [visitedSteps, setVisitedSteps] = useState<Set<CreateVaultStepId>>(() => new Set(["source"]));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [testingPassword, setTestingPassword] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const empty = createEmptyDraft(existingOrders);
    const starting = initialDraft ?? empty;
    setBaseline(starting);
    setDraft(starting);
    setCurrentStep(initialDraft ? "identity" : "source");
    setVisitedSteps(initialDraft ? new Set(["source", "identity"]) : new Set(["source"]));
    setSubmitAttempted(false);
    setTestingPassword(false);
    setDiscardConfirmOpen(false);
  }, [open, existingOrders, initialDraft]);

  const isDirty = useMemo(
    () => !createVaultDraftEqual(draft, baseline),
    [draft, baseline],
  );

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
  }, []);

  const patchDraft = useCallback((patch: Partial<CreateVaultDraft>) => {
    setDiscardConfirmOpen(false);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const stepStatuses = useMemo(() => {
    const statuses = {} as Record<CreateVaultStepId, CreateVaultStepStatus>;
    for (const stepId of CREATE_VAULT_STEPS) {
      statuses[stepId] = getCreateVaultStepStatus(
        stepId,
        draft,
        existingVaultIds,
        visitedSteps,
        submitAttempted,
      );
    }
    return statuses;
  }, [draft, existingVaultIds, visitedSteps, submitAttempted]);

  const currentStepIndex = CREATE_VAULT_STEPS.indexOf(currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === CREATE_VAULT_STEPS.length - 1;
  const currentErrors = validateCreateVaultStep(currentStep, draft, existingVaultIds);
  const canCreate = canSubmitCreateVault(draft, existingVaultIds);

  const goToStep = (stepId: CreateVaultStepId) => {
    setDiscardConfirmOpen(false);
    setCurrentStep(stepId);
    setVisitedSteps((current) => new Set(current).add(stepId));
  };

  const handleBack = () => {
    if (isFirstStep) return;
    goToStep(CREATE_VAULT_STEPS[currentStepIndex - 1]);
  };

  const handleNext = () => {
    setVisitedSteps((current) => new Set(current).add(currentStep));
    if (!isLastStep) goToStep(CREATE_VAULT_STEPS[currentStepIndex + 1]);
  };

  const handleTestImportPassword = () => {
    setTestingPassword(true);
    window.setTimeout(() => {
      const ok = mockTestArchivePassword(draft.password);
      patchDraft({
        passwordValidated: ok,
        passwordTestFailed: !ok,
      });
      setTestingPassword(false);
      setVisitedSteps((current) => new Set(current).add("password"));
    }, 400);
  };

  const handleCreate = () => {
    setSubmitAttempted(true);
    setVisitedSteps(new Set(CREATE_VAULT_STEPS));
    if (!canSubmitCreateVault(draft, existingVaultIds)) return;
    onCreate(buildCreateVaultResult(draft, existingVaultIds));
    handleClose();
  };

  const handleClose = () => {
    setDiscardConfirmOpen(false);
    setSubmitAttempted(false);
    onClose();
  };

  const requestClose = () => {
    if (discardConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    handleClose();
  };

  const handleDiscardAndClose = () => {
    setDraft(baseline);
    handleClose();
  };

  if (!open) return null;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-[1.25rem] text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : (
          <Button variant="ghost" size="md" disabled={isFirstStep || discardConfirmOpen} onClick={handleBack}>
            {t("vault.create.action.back")}
          </Button>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
        {discardConfirmOpen ? (
          <>
            <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
              {t("modal.settings.discard_keep_editing")}
            </Button>
            <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
              {t("modal.settings.discard_confirm_action")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="md" onClick={requestClose}>
              {t("action.cancel")}
            </Button>
            {isLastStep ? (
              <Button variant="primary" size="md" disabled={!canCreate} onClick={handleCreate}>
                {t("vault.create.action.create")}
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={handleNext}>
                {t("vault.create.action.next")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("vault.create.title")}
      onClose={requestClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <div
        className="max-h-[min(52vh,30rem)] overflow-y-auto p-1 [scrollbar-gutter:stable] sm:max-h-[min(58vh,34rem)]"
        onPointerDown={() => {
          if (discardConfirmOpen) dismissFooterConfirm();
        }}
      >
        {renderCreateVaultStep(currentStep, {
          draft,
          errors: submitAttempted || visitedSteps.has(currentStep) ? currentErrors : [],
          onChange: patchDraft,
          onTestImportPassword: handleTestImportPassword,
          testingPassword,
        })}
      </div>
      <CreateVaultStepNav currentStep={currentStep} stepStatuses={stepStatuses} onSelectStep={goToStep} />
    </Modal>
  );
}
