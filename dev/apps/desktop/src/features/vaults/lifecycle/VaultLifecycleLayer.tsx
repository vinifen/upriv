import type { I18nKey } from "@/i18n/types";
import type { VaultClosePrompt, VaultListItem, VaultRowWork } from "@upriv/shared";
import { CloseNowModal } from "./modals/CloseNowModal";
import { PlainHeldModal, PlainPlaceModal } from "./modals/PlainFolderModals";
import { VaultLifecycleModal } from "./modals/VaultLifecycleModal";
import { VaultClosePromptModal } from "./modals/VaultClosePromptModal";
import { VaultRecoveryModal } from "./modals/VaultRecoveryModal";
import type {
  PlainFolderClass,
  PlainLeftover,
  PlainPlaceChoice,
  PlainRecoveryAction,
} from "@upriv/shared";

interface VaultLifecycleLayerProps {
  lifecycleVault: VaultListItem | null;
  lifecycleOpen: boolean;
  lifecycleSubmitting?: boolean;
  lifecyclePipelineStep?: number;
  lifecycleWork?: VaultRowWork | null;
  lifecycleVerifyErrorKey?: I18nKey | null;
  lifecycleFieldPassword?: string;
  onLifecycleClose: () => void;
  onLifecycleConfirm: (password: string) => void;
  onLifecycleStop: () => void;
  onLifecycleRebuild: (password: string) => void;
  recoveryVault: VaultListItem | null;
  recoveryLeftover: PlainLeftover | null | undefined;
  recoveryOpen: boolean;
  onRecoveryClose: () => void;
  onRecoveryAction: (action: PlainRecoveryAction) => void;
  placeOpen: boolean;
  placeVaultName: string;
  placeWorkspaceChoices: boolean;
  placeSubmitting: boolean;
  placeWarningClass: PlainFolderClass | null;
  onPlaceClose: () => void;
  onPlaceContinue: (choice: PlainPlaceChoice, path: string) => void;
  onPlaceAcceptWarning: () => void;
  heldOpen: boolean;
  heldCount: number;
  heldPaths: readonly string[];
  heldSubmitting: boolean;
  onHeldApply: () => void;
  onHeldRestore: () => void;
  closeNowVault: VaultListItem | null;
  closeNowUnsaved: boolean;
  closeNowAsks: boolean;
  onCloseNowCancel: () => void;
  onCloseNowConfirm: (dontAskAgain: boolean) => void;
  closePrompt: VaultClosePrompt | null;
  closePromptVaultName?: string;
  closePromptSaving: boolean;
  onClosePromptCancel: () => void;
  onClosePromptDiscard: () => void;
  onClosePromptSave: () => void;
  onClosePromptSaveTimeout: () => void;
  onClosePromptCancelImport: () => void;
}

/** Unlock password dialog, plaintext folder prompts, the close prompt, and recovery. */
export function VaultLifecycleLayer({
  lifecycleVault,
  lifecycleOpen,
  lifecycleSubmitting = false,
  lifecyclePipelineStep = 0,
  lifecycleWork = null,
  lifecycleVerifyErrorKey = null,
  lifecycleFieldPassword,
  onLifecycleClose,
  onLifecycleConfirm,
  onLifecycleStop,
  onLifecycleRebuild,
  recoveryVault,
  recoveryLeftover,
  recoveryOpen,
  onRecoveryClose,
  onRecoveryAction,
  placeOpen,
  placeVaultName,
  placeWorkspaceChoices,
  placeSubmitting,
  placeWarningClass,
  onPlaceClose,
  onPlaceContinue,
  onPlaceAcceptWarning,
  heldOpen,
  heldCount,
  heldPaths,
  heldSubmitting,
  onHeldApply,
  onHeldRestore,
  closeNowVault,
  closeNowUnsaved,
  closeNowAsks,
  onCloseNowCancel,
  onCloseNowConfirm,
  closePrompt,
  closePromptVaultName,
  closePromptSaving,
  onClosePromptCancel,
  onClosePromptDiscard,
  onClosePromptSave,
  onClosePromptSaveTimeout,
  onClosePromptCancelImport,
}: VaultLifecycleLayerProps) {
  return (
    <>
      <VaultLifecycleModal
        vault={lifecycleVault}
        open={lifecycleOpen && !placeOpen}
        submitting={lifecycleSubmitting}
        pipelineStep={lifecyclePipelineStep}
        work={lifecycleWork}
        verifyErrorKey={lifecycleVerifyErrorKey}
        initialPassword={lifecycleFieldPassword}
        onClose={onLifecycleClose}
        onConfirm={onLifecycleConfirm}
        onStop={onLifecycleStop}
        onRebuild={onLifecycleRebuild}
      />
      <PlainPlaceModal
        open={placeOpen}
        vaultName={placeVaultName}
        workspaceChoices={placeWorkspaceChoices}
        submitting={placeSubmitting}
        warningClass={placeWarningClass}
        onClose={onPlaceClose}
        onContinue={onPlaceContinue}
        onAcceptWarning={onPlaceAcceptWarning}
      />
      <PlainHeldModal
        open={heldOpen}
        count={heldCount}
        paths={heldPaths}
        submitting={heldSubmitting}
        onApply={onHeldApply}
        onRestore={onHeldRestore}
      />
      <VaultClosePromptModal
        prompt={closePrompt}
        vaultName={closePromptVaultName}
        saving={closePromptSaving}
        onCancel={onClosePromptCancel}
        onDiscard={onClosePromptDiscard}
        onSave={onClosePromptSave}
        onSaveTimeout={onClosePromptSaveTimeout}
        onCancelImport={onClosePromptCancelImport}
      />
      <CloseNowModal
        target={
          closeNowVault ? { kind: "vault", vault: closeNowVault, unsaved: closeNowUnsaved } : null
        }
        asks={closeNowAsks}
        onCancel={onCloseNowCancel}
        onConfirm={onCloseNowConfirm}
      />
      <VaultRecoveryModal
        vault={recoveryVault}
        leftover={recoveryLeftover}
        open={recoveryOpen}
        onClose={onRecoveryClose}
        onAction={onRecoveryAction}
      />
    </>
  );
}
