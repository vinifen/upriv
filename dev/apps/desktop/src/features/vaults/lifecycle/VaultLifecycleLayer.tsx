import type { I18nKey } from "@/i18n/types";
import type { VaultLifecycleIntent, VaultListItem } from "@upriv/shared";
import { VaultClosingOverlay } from "./pipeline/VaultClosingOverlay";
import { VaultOpeningOverlay } from "./pipeline/VaultOpeningOverlay";
import { VaultLifecycleModal } from "./modals/VaultLifecycleModal";
import { VaultRecoveryModal, type RecoveryAction } from "./modals/VaultRecoveryModal";

interface VaultLifecycleLayerProps {
  lifecycleVault: VaultListItem | null;
  lifecycleIntent: VaultLifecycleIntent | null;
  lifecycleOpen: boolean;
  onLifecycleClose: () => void;
  onLifecycleConfirm: (password: string | null) => void;
  recoveryVault: VaultListItem | null;
  recoveryOpen: boolean;
  recoverySubmitting: boolean;
  onRecoveryClose: () => void;
  onRecoveryAction: (action: RecoveryAction) => void;
  pipelineVault: VaultListItem | null;
  pipelineClosingIntent: Extract<VaultLifecycleIntent, "close" | "seal"> | null;
  closingOverlayOpen: boolean;
  openingOverlayOpen: boolean;
  activeStep: number;
  errorKey: I18nKey | null;
  onPipelineBackground: () => void;
  onDismissPipelineError: () => void;
}

/** Unlock/close/seal modals, recovery, and pipeline overlays. */
export function VaultLifecycleLayer({
  lifecycleVault,
  lifecycleIntent,
  lifecycleOpen,
  onLifecycleClose,
  onLifecycleConfirm,
  recoveryVault,
  recoveryOpen,
  recoverySubmitting,
  onRecoveryClose,
  onRecoveryAction,
  pipelineVault,
  pipelineClosingIntent,
  closingOverlayOpen,
  openingOverlayOpen,
  activeStep,
  errorKey,
  onPipelineBackground,
  onDismissPipelineError,
}: VaultLifecycleLayerProps) {
  return (
    <>
      <VaultLifecycleModal
        vault={lifecycleVault}
        intent={lifecycleIntent}
        open={lifecycleOpen}
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
      <VaultClosingOverlay
        vault={pipelineVault}
        intent={pipelineClosingIntent}
        open={closingOverlayOpen}
        activeStep={activeStep}
        errorKey={errorKey}
        onBackground={onPipelineBackground}
        onDismissError={onDismissPipelineError}
      />
      <VaultOpeningOverlay
        vault={pipelineVault}
        open={openingOverlayOpen}
        activeStep={activeStep}
        errorKey={errorKey}
        onBackground={onPipelineBackground}
        onDismissError={onDismissPipelineError}
      />
    </>
  );
}
