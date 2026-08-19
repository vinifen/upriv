import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  buildCreateVaultResult,
  canSubmitCreateVault,
  createEmptyCreateVaultDraft,
  createVaultDraftEqual,
  CREATE_VAULT_STEPS,
  getCreateVaultStepStatus,
  validateCreateVaultStep,
  type CreateVaultDraft,
  type CreateVaultResult,
  type CreateVaultStepId,
  type CreateVaultStepStatus,
  type VaultGroup,
} from "@upriv/shared";
import { useCreateVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { MODAL_MAX_HEIGHT_RATIO, spacing } from "@/theme/tokens";
import { Button, Modal } from "@/components/ui";
import { CreateVaultStepNav } from "./CreateVaultStepNav";
import { renderCreateVaultStep } from "./createVaultSteps";

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

/** Create-vault wizard — desktop `CreateVaultWizardModal` structure parity. */
export function CreateVaultModal({
  open,
  onClose,
  existingVaultIds,
  existingOrders,
  groups = [],
  initialDraft = null,
  initialStep = null,
  onCreate,
}: CreateVaultModalProps) {
  const { t } = useTranslation();
  const { typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const createVaultService = useCreateVaultService();
  /**
   * Cap the step pane against remaining dialog height (header + step nav + footer),
   * not raw window height — avoids clipping chrome on short phones.
   */
  const stepPaneMaxHeight = useMemo(() => {
    const framePadTop = Math.max(insets.top, spacing.md);
    const framePadBottom = Math.max(insets.bottom, spacing.md);
    const dialogMaxHeight = Math.max(
      240,
      Math.round(windowHeight * MODAL_MAX_HEIGHT_RATIO) - framePadTop - framePadBottom,
    );
    const chromeReserve = 52 /* title */ + 56 /* step nav */ + 72 /* footer */;
    return Math.max(120, Math.min(dialogMaxHeight - chromeReserve, 680));
  }, [insets.bottom, insets.top, windowHeight]);
  const [baseline, setBaseline] = useState<CreateVaultDraft>(() =>
    createEmptyCreateVaultDraft(existingOrders),
  );
  const [draft, setDraft] = useState<CreateVaultDraft>(() =>
    createEmptyCreateVaultDraft(existingOrders),
  );
  const [currentStep, setCurrentStep] = useState<CreateVaultStepId>("source");
  const [visitedSteps, setVisitedSteps] = useState<Set<CreateVaultStepId>>(
    () => new Set(["source"]),
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [testingPassword, setTestingPassword] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const empty = createEmptyCreateVaultDraft(existingOrders);
    const starting = initialDraft ?? empty;
    const step = initialStep ?? (initialDraft ? "identity" : "source");
    setBaseline(starting);
    setDraft(starting);
    setCurrentStep(step);
    setVisitedSteps(step === "source" ? new Set(["source"]) : new Set(["source", "identity"]));
    setSubmitAttempted(false);
    setTestingPassword(false);
    setDiscardConfirmOpen(false);
  }, [open, existingOrders, initialDraft, initialStep]);

  const isDirty = useMemo(() => !createVaultDraftEqual(draft, baseline), [draft, baseline]);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
  }, []);

  const patchDraft = useCallback((patch: Partial<CreateVaultDraft>) => {
    setDiscardConfirmOpen(false);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const knownGroupIds = useMemo(() => groups.map((group) => group.id), [groups]);

  const stepStatuses = useMemo(() => {
    const statuses = {} as Record<CreateVaultStepId, CreateVaultStepStatus>;
    for (const stepId of CREATE_VAULT_STEPS) {
      statuses[stepId] = getCreateVaultStepStatus(
        stepId,
        draft,
        existingVaultIds,
        visitedSteps,
        submitAttempted,
        knownGroupIds,
      );
    }
    return statuses;
  }, [draft, existingVaultIds, knownGroupIds, visitedSteps, submitAttempted]);

  const currentStepIndex = CREATE_VAULT_STEPS.indexOf(currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === CREATE_VAULT_STEPS.length - 1;
  const currentErrors = validateCreateVaultStep(
    currentStep,
    draft,
    existingVaultIds,
    knownGroupIds,
  );
  const canCreate = canSubmitCreateVault(draft, existingVaultIds, knownGroupIds);

  const goToStep = (stepId: CreateVaultStepId) => {
    setDiscardConfirmOpen(false);
    setCurrentStep(stepId);
    setVisitedSteps((current) => new Set(current).add(stepId));
  };

  const handleBack = () => {
    if (isFirstStep) return;
    goToStep(CREATE_VAULT_STEPS[currentStepIndex - 1]);
  };

  /** Desktop advances even with step errors (errors show when visited). */
  const handleNext = () => {
    setVisitedSteps((current) => new Set(current).add(currentStep));
    if (!isLastStep) goToStep(CREATE_VAULT_STEPS[currentStepIndex + 1]);
  };

  const handleTestImportPassword = () => {
    setTestingPassword(true);
    setTimeout(() => {
      const ok = createVaultService.testImportArchivePassword(draft.password);
      patchDraft({
        passwordValidated: ok,
        passwordTestFailed: !ok,
      });
      setTestingPassword(false);
      setVisitedSteps((current) => new Set(current).add("password"));
    }, 400);
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

  const handleCreate = () => {
    setSubmitAttempted(true);
    setVisitedSteps(new Set(CREATE_VAULT_STEPS));
    if (!canSubmitCreateVault(draft, existingVaultIds, knownGroupIds)) return;
    onCreate(buildCreateVaultResult(draft, existingVaultIds));
    handleClose();
  };

  const footer = (
    <View style={styles.footer}>
      <View style={styles.footerLeft}>
        {discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : (
          <Button
            variant="ghost"
            label={t("vault.create.action.back")}
            disabled={isFirstStep}
            onPress={handleBack}
          />
        )}
      </View>
      <View style={styles.footerRight}>
        {discardConfirmOpen ? (
          <>
            <Button
              variant="ghost"
              label={t("modal.settings.discard_keep_editing")}
              onPress={dismissFooterConfirm}
            />
            <Button
              variant="danger"
              label={t("modal.settings.discard_confirm_action")}
              onPress={handleDiscardAndClose}
            />
          </>
        ) : (
          <>
            <Button variant="ghost" label={t("action.cancel")} onPress={requestClose} />
            {isLastStep ? (
              <Button
                variant="primary"
                label={t("vault.create.action.create")}
                disabled={!canCreate}
                onPress={handleCreate}
              />
            ) : (
              <Button
                variant="primary"
                label={t("vault.create.action.next")}
                onPress={handleNext}
              />
            )}
          </>
        )}
      </View>
    </View>
  );

  return (
    <Modal
      open={open}
      title={t("vault.create.title")}
      onClose={requestClose}
      panelClassName="max-w-3xl"
      bodyScroll={false}
      footer={footer}
    >
      <ScrollView
        style={{ maxHeight: stepPaneMaxHeight }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onScrollBeginDrag={discardConfirmOpen ? dismissFooterConfirm : undefined}
      >
        {renderCreateVaultStep(currentStep, {
          draft,
          errors: submitAttempted || visitedSteps.has(currentStep) ? currentErrors : [],
          onChange: patchDraft,
          groups,
          onTestImportPassword: handleTestImportPassword,
          testingPassword,
        })}
      </ScrollView>
      <CreateVaultStepNav
        currentStep={currentStep}
        stepStatuses={stepStatuses}
        onSelectStep={goToStep}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  footerLeft: { flexGrow: 1, flexShrink: 1, minWidth: 120 },
  footerRight: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
    flexShrink: 0,
  },
});
