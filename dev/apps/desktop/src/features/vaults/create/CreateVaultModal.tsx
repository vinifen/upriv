import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useCreateVaultService, useVaultRootService } from "@/platform/services";
import {
  NO_VAULT_GROUPS,
  vaultRootPathForWorkspaceValidation,
  type CreateVaultDraft,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
} from "@upriv/shared";
import { useCreateVaultWizard } from "@upriv/shared/react";
import { CreateVaultStepNav } from "./CreateVaultStepNav";
import { renderCreateVaultStep } from "./createVaultSteps";

interface CreateVaultModalProps {
  open: boolean;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  groups?: readonly VaultGroup[];
  initialDraft?: CreateVaultDraft | null;
  initialStep?: CreateVaultStepId | null;
  onClose: () => void;
  onCreate: (result: CreateVaultResult, password: string) => void;
}

export function CreateVaultModal({
  open,
  existingVaultIds,
  existingOrders,
  groups = NO_VAULT_GROUPS,
  initialDraft = null,
  initialStep = null,
  onClose,
  onCreate,
}: CreateVaultModalProps) {
  const { t } = useTranslation();
  const createVaultService = useCreateVaultService();
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultRootService = useVaultRootService();
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResolvedRootPath(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve({
          vaultRootMode: appSettings.app.vault_root_mode,
        });
        if (cancelled) return;
        if (resolved.status === "found") {
          setResolvedRootPath(resolved.rootPath);
        } else {
          setResolvedRootPath(resolved.defaultRootAnchor);
        }
      } catch {
        if (!cancelled) setResolvedRootPath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, appSettings.app.vault_root_mode, vaultRootService]);

  const vaultRootPath = vaultRootPathForWorkspaceValidation(
    appSettings.app.vault_root_mode,
    appSettings.app.upriv_root_path,
    resolvedRootPath,
  );
  const includeHidden = appSettings.ui.always_show_hidden_vaults || showHiddenVaultsSession;

  const wizard = useCreateVaultWizard({
    open,
    existingVaultIds,
    existingOrders,
    groups,
    vaultRootPath,
    initialDraft,
    initialStep,
    onCreate,
    onClose,
    testImportPassword: (password) => createVaultService.testImportPackagePassword(password),
  });

  const {
    draft,
    currentStep,
    stepStatuses,
    inlineErrors,
    isFirstStep,
    isLastStep,
    canCreate,
    discardConfirmOpen,
    testingPassword,
    patchDraft,
    goToStep,
    handleBack,
    handleNext,
    handleCreate,
    handleTestImportPassword,
    requestClose,
    handleDiscardAndClose,
    dismissFooterConfirm,
    stepFocus,
  } = wizard;

  useEffect(() => {
    if (!open) setCreateError(null);
  }, [open]);

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="sm:min-w-0 sm:flex-1">
        <div className="text-sm" aria-live="polite">
          {discardConfirmOpen ? (
            <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
          ) : createError ? (
            <p className="text-on-error-container">{createError}</p>
          ) : null}
        </div>
        {!discardConfirmOpen ? (
          <div className="flex min-h-10 items-center">
            <Button variant="ghost" size="md" disabled={isFirstStep} onClick={handleBack}>
              {t("vault.create.action.back")}
            </Button>
          </div>
        ) : null}
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
              <Button
                variant="primary"
                size="md"
                disabled={!canCreate}
                onClick={() => {
                  setCreateError(null);
                  try {
                    void handleCreate();
                  } catch (error) {
                    setCreateError(t(desktopErrorI18nKey(error)));
                  }
                }}
              >
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
      titleIcon="add"
      onClose={requestClose}
      panelClassName="max-w-3xl"
      bodyScroll={false}
      footer={footer}
    >
      <div className="flex min-h-[min(24rem,60dvh)] min-w-0 flex-1 flex-col">
        <CreateVaultStepNav
          currentStep={currentStep}
          stepStatuses={stepStatuses}
          onSelectStep={goToStep}
        />
        <div
          className="min-h-0 flex-1 overflow-y-auto p-1"
          onPointerDown={() => {
            if (discardConfirmOpen) dismissFooterConfirm();
          }}
        >
          {renderCreateVaultStep(currentStep, {
            draft,
            errors: inlineErrors,
            onChange: patchDraft,
            groups,
            includeHidden,
            vaultRootPath,
            onTestImportPassword: handleTestImportPassword,
            testingPassword,
            ...stepFocus,
          })}
        </div>
      </div>
    </Modal>
  );
}
