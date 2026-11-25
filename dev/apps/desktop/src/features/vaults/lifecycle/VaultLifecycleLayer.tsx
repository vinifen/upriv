import type { I18nKey } from "@/i18n/types";
import type { VaultClosePrompt, VaultListItem, VaultRowWork } from "@upriv/shared";
import { CloseNowModal } from "./modals/CloseNowModal";
import { PlainHeldModal, PlainPlaceModal } from "./modals/PlainFolderModals";
import { VaultLifecycleModal } from "./modals/VaultLifecycleModal";
import { VaultClosePromptModal } from "./modals/VaultClosePromptModal";
import { VaultRecoveryModal } from "./modals/VaultRecoveryModal";
import {
  UnlockedFolderDriverModal,
  type UnlockedFolderDriver,
} from "./modals/UnlockedFolderDriverModal";
import type {
  AppUnlockedChoice,
  DeviceGroups,
  PlainLeftover,
  PlainPlaceChoice,
  PlainRecoveryAction,
  UnlockedDestination,
  VaultUnlockedChoice,
} from "@upriv/shared";

interface VaultLifecycleLayerProps {
  lifecycleVault: VaultListItem | null;
  lifecycleOpen: boolean;
  lifecycleSubmitting?: boolean;
  lifecyclePipelineStep?: number;
  lifecycleWork?: VaultRowWork | null;
  lifecycleVerifyErrorKey?: I18nKey | null;
  lifecycleFieldPassword?: string;
  /** Where the files will appear, when the step before the window looked it up. */
  lifecycleDestination?: UnlockedDestination | null;
  onLifecycleClose: () => void;
  onLifecycleConfirm: (password: string) => void;
  onLifecycleStop: () => void;
  onLifecycleRebuild: (password: string) => void;
  recoveryVault: VaultListItem | null;
  recoveryLeftover: PlainLeftover | null | undefined;
  recoveryOpen: boolean;
  onRecoveryClose: () => void;
  onRecoveryAction: (action: PlainRecoveryAction) => void;
  /** The recovery vault's Password screen, to finish a change that left files behind. */
  onRecoveryFinishPasswordChange: () => void;
  /** The recovery vault's Delete vault window, for one whose import was cut off. */
  onRecoveryDelete: () => void;
  placeOpen: boolean;
  placeVaultName: string;
  /** The app's unlocked folders can change: no vault is open. */
  placeAppChoices: boolean;
  /** The app's unlocked folders, which a folder typed for the app's list may not repeat. */
  placeAppUnlocked: DeviceGroups<AppUnlockedChoice>;
  /** The vault's own unlocked folders; `null` while they load. */
  placeVaultUnlocked: DeviceGroups<VaultUnlockedChoice> | null;
  placeSubmitting: boolean;
  onPlaceClose: () => void;
  onPlaceContinue: (choice: PlainPlaceChoice, path: string) => void;
  heldOpen: boolean;
  heldCount: number;
  heldPaths: readonly string[];
  heldSubmitting: boolean;
  onHeldApply: () => void;
  onHeldRestore: () => void;
  /** An encrypted vault that opened without its unlocked folder's driver. */
  driverPromptVaultName: string | null;
  driverKind: UnlockedFolderDriver;
  driverInstalling: boolean;
  onDriverInstall: () => void;
  onDriverDismiss: () => void;
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
  lifecycleDestination = null,
  onLifecycleClose,
  onLifecycleConfirm,
  onLifecycleStop,
  onLifecycleRebuild,
  recoveryVault,
  recoveryLeftover,
  recoveryOpen,
  onRecoveryClose,
  onRecoveryAction,
  onRecoveryFinishPasswordChange,
  onRecoveryDelete,
  placeOpen,
  placeVaultName,
  placeAppChoices,
  placeAppUnlocked,
  placeVaultUnlocked,
  placeSubmitting,
  onPlaceClose,
  onPlaceContinue,
  heldOpen,
  heldCount,
  heldPaths,
  heldSubmitting,
  onHeldApply,
  onHeldRestore,
  driverPromptVaultName,
  driverKind,
  driverInstalling,
  onDriverInstall,
  onDriverDismiss,
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
        destination={lifecycleDestination}
        onClose={onLifecycleClose}
        onConfirm={onLifecycleConfirm}
        onStop={onLifecycleStop}
        onRebuild={onLifecycleRebuild}
      />
      <PlainPlaceModal
        open={placeOpen}
        vaultName={placeVaultName}
        appChoices={placeAppChoices}
        appUnlocked={placeAppUnlocked}
        vaultUnlocked={placeVaultUnlocked}
        submitting={placeSubmitting}
        onClose={onPlaceClose}
        onContinue={onPlaceContinue}
      />
      <UnlockedFolderDriverModal
        vaultName={driverPromptVaultName}
        driver={driverKind}
        installing={driverInstalling}
        onInstall={onDriverInstall}
        onDismiss={onDriverDismiss}
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
        onFinishPasswordChange={onRecoveryFinishPasswordChange}
        onDelete={onRecoveryDelete}
      />
    </>
  );
}
