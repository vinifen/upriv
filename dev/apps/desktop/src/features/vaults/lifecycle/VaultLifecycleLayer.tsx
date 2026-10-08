import type { I18nKey } from "@/i18n/types";
import type { VaultLifecycleIntent, VaultListItem } from "@upriv/shared";
import { CloseAllUnsavedModal } from "./modals/CloseAllUnsavedModal";
import { VaultLifecycleModal } from "./modals/VaultLifecycleModal";
import { VaultRecoveryModal, type RecoveryAction } from "./modals/VaultRecoveryModal";
interface VaultLifecycleLayerProps {
  lifecycleVault: VaultListItem | null;
  lifecycleIntent: VaultLifecycleIntent | null;
  lifecycleOpen: boolean;
  lifecycleSubmitting?: boolean;
  lifecyclePipelineStep?: number;
  lifecycleBudgetStartedAt?: number;
  lifecycleVerifyErrorKey?: I18nKey | null;
  lifecycleFieldPassword?: string;
  onLifecycleClose: () => void;
  onLifecycleConfirm: (password: string | null) => void;
  recoveryVault: VaultListItem | null;
  recoveryOpen: boolean;
  recoverySubmitting: boolean;
  onRecoveryClose: () => void;
  onRecoveryAction: (action: RecoveryAction) => void;
  closeAllUnsavedOpen: boolean;
  closeAllUnsavedSaving: boolean;
  onCloseAllUnsavedCancel: () => void;
  onCloseAllUnsavedDiscard: () => void;
  onCloseAllUnsavedSave: () => void;
  onCloseAllUnsavedTimeout: () => void;
}

/** Unlock/close password dialog, close-all unsaved prompt, and recovery. */
export function VaultLifecycleLayer({
  lifecycleVault,
  lifecycleIntent,
  lifecycleOpen,
  lifecycleSubmitting = false,
  lifecyclePipelineStep = 0,
  lifecycleBudgetStartedAt,
  lifecycleVerifyErrorKey = null,
  lifecycleFieldPassword,
  onLifecycleClose,
  onLifecycleConfirm,
  recoveryVault,
  recoveryOpen,
  recoverySubmitting,
  onRecoveryClose,
  onRecoveryAction,
  closeAllUnsavedOpen,
  closeAllUnsavedSaving,
  onCloseAllUnsavedCancel,
  onCloseAllUnsavedDiscard,
  onCloseAllUnsavedSave,
  onCloseAllUnsavedTimeout,
}: VaultLifecycleLayerProps) {
  return (
    <>
      <VaultLifecycleModal
        vault={lifecycleVault}
        intent={lifecycleIntent}
        open={lifecycleOpen}
        submitting={lifecycleSubmitting}
        pipelineStep={lifecyclePipelineStep}
        budgetStartedAt={lifecycleBudgetStartedAt}
        verifyErrorKey={lifecycleVerifyErrorKey}
        initialPassword={lifecycleFieldPassword}
        onClose={onLifecycleClose}
        onConfirm={onLifecycleConfirm}
      />
      <CloseAllUnsavedModal
        open={closeAllUnsavedOpen}
        saving={closeAllUnsavedSaving}
        onCancel={onCloseAllUnsavedCancel}
        onDiscard={onCloseAllUnsavedDiscard}
        onSave={onCloseAllUnsavedSave}
        onSaveTimeout={onCloseAllUnsavedTimeout}
      />
      <VaultRecoveryModal
        vault={recoveryVault}
        open={recoveryOpen}
        submitting={recoverySubmitting}
        onClose={onRecoveryClose}
        onAction={onRecoveryAction}
      />
    </>
  );
}
