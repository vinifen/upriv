import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { buildCreateVaultResult } from "./buildCreateVaultResult";
import { createEmptyDraft } from "./createVaultDefaults";
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
  onClose: () => void;
  onCreate: (result: CreateVaultResult) => void;
}

export function CreateVaultWizardModal({
  open,
  existingVaultIds,
  existingOrders,
  onClose,
  onCreate,
}: CreateVaultWizardModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CreateVaultDraft>(() => createEmptyDraft(existingOrders));
  const [currentStep, setCurrentStep] = useState<CreateVaultStepId>("source");
  const [visitedSteps, setVisitedSteps] = useState<Set<CreateVaultStepId>>(() => new Set(["source"]));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [testingPassword, setTestingPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(createEmptyDraft(existingOrders));
    setCurrentStep("source");
    setVisitedSteps(new Set(["source"]));
    setSubmitAttempted(false);
    setTestingPassword(false);
  }, [open, existingOrders]);

  const patchDraft = useCallback((patch: Partial<CreateVaultDraft>) => {
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
    onClose();
  };

  const handleClose = () => {
    setSubmitAttempted(false);
    onClose();
  };

  if (!open) return null;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" size="md" disabled={isFirstStep} onClick={handleBack}>
        {t("vault.create.action.back")}
      </Button>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
        <Button variant="ghost" size="md" onClick={handleClose}>
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
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("vault.create.title")}
      onClose={handleClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <div className="max-h-[min(52vh,30rem)] overflow-y-auto p-1 [scrollbar-gutter:stable] sm:max-h-[min(58vh,34rem)]">
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
