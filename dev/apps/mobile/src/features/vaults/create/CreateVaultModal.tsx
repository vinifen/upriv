import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NO_VAULT_GROUPS,
  vaultRootPathForWorkspaceValidation,
  type CreateVaultDraft,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
} from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings";
import { useCreateVaultService, useVaultRootService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { MODAL_MAX_HEIGHT_RATIO, spacing } from "@/theme/tokens";
import { Button, Modal, ModalFooterNav, modalFooterConfirmBtnStyle } from "@/components/ui";
import { useTapNotPan } from "@/components/ui/ScrimDismiss";
import { CreateVaultStepNav } from "./CreateVaultStepNav";
import { renderCreateVaultStep } from "./createVaultSteps";
import { useCreateVaultWizard } from "@upriv/shared/react";

interface CreateVaultModalProps {
  open: boolean;
  onClose: () => void;
  existingVaultIds: readonly string[];
  existingOrders: readonly number[];
  groups?: readonly VaultGroup[];
  initialDraft?: CreateVaultDraft | null;
  initialStep?: CreateVaultStepId | null;
  onCreate: (result: CreateVaultResult) => void;
}

/** Create-vault wizard — same step flow as desktop `CreateVaultModal`. */
export function CreateVaultModal({
  open,
  onClose,
  existingVaultIds,
  existingOrders,
  groups = NO_VAULT_GROUPS,
  initialDraft = null,
  initialStep = null,
  onCreate,
}: CreateVaultModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const createVaultService = useCreateVaultService();
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultRootService = useVaultRootService();
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);

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

  const stepPaneMaxHeight = useMemo(() => {
    const framePadTop = Math.max(insets.top, spacing.md);
    const framePadBottom = Math.max(insets.bottom, spacing.md);
    const dialogMaxHeight = Math.max(
      240,
      Math.round(windowHeight * MODAL_MAX_HEIGHT_RATIO) - framePadTop - framePadBottom,
    );
    const chromeReserve = 52 + 56 + 72;
    return Math.max(120, Math.min(dialogMaxHeight - chromeReserve, 680));
  }, [insets.bottom, insets.top, windowHeight]);

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
  const dismissConfirmOnBodyTap = useTapNotPan(dismissFooterConfirm, discardConfirmOpen);

  const footer = (
    <ModalFooterNav
      leading={
        discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : (
          <Button
            variant="ghost"
            label={t("vault.create.action.back")}
            style={modalFooterConfirmBtnStyle}
            disabled={isFirstStep}
            onPress={handleBack}
          />
        )
      }
      trailing={
        discardConfirmOpen ? (
          <>
            <Button
              variant="ghost"
              label={t("modal.settings.discard_keep_editing")}
              style={modalFooterConfirmBtnStyle}
              onPress={dismissFooterConfirm}
            />
            <Button
              variant="danger"
              label={t("modal.settings.discard_confirm_action")}
              style={modalFooterConfirmBtnStyle}
              onPress={handleDiscardAndClose}
            />
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              label={t("action.cancel")}
              style={modalFooterConfirmBtnStyle}
              onPress={requestClose}
            />
            {isLastStep ? (
              <Button
                variant="primary"
                label={t("vault.create.action.create")}
                style={modalFooterConfirmBtnStyle}
                disabled={!canCreate}
                onPress={handleCreate}
              />
            ) : (
              <Button
                variant="primary"
                label={t("vault.create.action.next")}
                style={modalFooterConfirmBtnStyle}
                onPress={handleNext}
              />
            )}
          </>
        )
      }
    />
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
      <CreateVaultStepNav
        currentStep={currentStep}
        stepStatuses={stepStatuses}
        onSelectStep={goToStep}
      />
      <ScrollView
        style={{ maxHeight: stepPaneMaxHeight }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        {...dismissConfirmOnBodyTap}
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
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.sm },
});
