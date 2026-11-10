import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useCreateVaultService, useJobService, useVaultRootService } from "@/platform/services";
import {
  NO_VAULT_GROUPS,
  PASSWORD_WEAKNESS_I18N_KEYS,
  vaultRootPathForWorkspaceValidation,
  type CreateVaultDraft,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
} from "@upriv/shared";
import { useCreateVaultWizard } from "@upriv/shared/react";
import { CreateVaultStepNav } from "./CreateVaultStepNav";
import { invalidateImportPicks, renderCreateVaultStep } from "./createVaultSteps";

/** Above the buttons and out of the flow, so they stay exactly where they are. */
const FOOTER_NOTICE_CLASS =
  "absolute inset-x-0 bottom-full bg-surface-container-high pb-1.5 text-on-error-container";

interface CreateVaultModalProps {
  open: boolean;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  existingDisplayNames?: readonly string[];
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
  existingDisplayNames = [],
  groups = NO_VAULT_GROUPS,
  initialDraft = null,
  initialStep = null,
  onClose,
  onCreate,
}: CreateVaultModalProps) {
  const { t } = useTranslation();
  const createVaultService = useCreateVaultService();
  const jobService = useJobService();
  const {
    settings: appSettings,
    showHiddenVaultsSession,
    reportVaultRootIntegrityFailure,
  } = useAppSettingsContext();
  const vaultRootService = useVaultRootService();
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [driverAttention, setDriverAttention] = useState(false);
  const [backupFolderBlocking, setBackupFolderBlocking] = useState(false);

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

  const reportImportVaultRootFailure = useCallback(
    (error: unknown) => {
      void reportVaultRootIntegrityFailure(error);
    },
    [reportVaultRootIntegrityFailure],
  );

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
    existingDisplayNames,
    groups,
    vaultRootPath,
    initialDraft,
    initialStep,
    onCreate,
    onClose,
    testImportPassword: (password, importFile, job) =>
      createVaultService.testImportPackagePassword(password, importFile, job),
    stopJob: (job) => jobService.cancel(job, "user"),
    readImportPackageSettings: (importFile) =>
      createVaultService.readImportPackageSettings(importFile),
    onVaultRootFailure: reportImportVaultRootFailure,
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
    passwordWeakness,
    footerPasswordWeakness,
    testingPassword,
    passwordTestStartedAt,
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
    stepFocus,
  } = wizard;

  useEffect(() => {
    if (!open) {
      setCreateError(null);
      setDriverAttention(false);
    }
    invalidateImportPicks();
  }, [open]);

  const footer = (
    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="sm:min-w-0 sm:flex-1">
        <div className="text-sm" aria-live="polite">
          {discardConfirmOpen ? (
            <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
          ) : createError ? (
            <p className="text-on-error-container">{createError}</p>
          ) : footerPasswordWeakness ? (
            <p className={FOOTER_NOTICE_CLASS}>
              {t(PASSWORD_WEAKNESS_I18N_KEYS[footerPasswordWeakness])}
            </p>
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
            {isLastStep ? (
              <Button
                variant="primary"
                size="md"
                disabled={!canCreate || driverAttention || backupFolderBlocking}
                onClick={() => {
                  if (driverAttention) return;
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
              <Button
                variant="primary"
                size="md"
                disabled={backupFolderBlocking}
                onClick={handleNext}
              >
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
            if (discardConfirmOpen || footerPasswordWeakness) dismissFooterConfirm();
          }}
        >
          {renderCreateVaultStep(currentStep, {
            draft,
            errors: inlineErrors,
            onChange: patchDraft,
            groups,
            includeHidden,
            existingDisplayNames,
            vaultRootPath,
            appWorkspace: appSettings.workspace,
            appBackups: appSettings.backups,
            onDriverAttentionChange: setDriverAttention,
            onBackupFolderBlockingChange: setBackupFolderBlocking,
            onTestImportPassword: handleTestImportPassword,
            onStopTestImportPassword: stopTestImportPassword,
            testingPassword,
            passwordTestStartedAt,
            passwordWeakness,
            ...stepFocus,
          })}
        </div>
      </div>
    </Modal>
  );
}
