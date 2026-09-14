import type { I18nKey } from "@/i18n/types";
import type { VaultLifecycleIntent, VaultListItem } from "@upriv/shared";
import { VaultLifecycleModal } from "./modals/VaultLifecycleModal";
import { VaultRecoveryModal, type RecoveryAction } from "./modals/VaultRecoveryModal";
import { WorkspaceSetupModal } from "./modals/WorkspaceSetupModal";

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
  workspaceSetupOpen: boolean;
  workspaceSetupRootPath: string;
  onWorkspaceSetupCancel: () => void;
  onWorkspaceSetupConfigured: () => void;
}

/** Unlock/close password dialog, workspace setup, and recovery. */
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
  workspaceSetupOpen,
  workspaceSetupRootPath,
  onWorkspaceSetupCancel,
  onWorkspaceSetupConfigured,
}: VaultLifecycleLayerProps) {
  return (
    <>
      <WorkspaceSetupModal
        open={workspaceSetupOpen}
        vaultRootPath={workspaceSetupRootPath}
        onCancel={onWorkspaceSetupCancel}
        onConfigured={onWorkspaceSetupConfigured}
      />
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
