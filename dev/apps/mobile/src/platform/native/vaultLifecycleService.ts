import {
  CLOSING_BACKUP_STEP,
  CLOSING_DONE_STEP,
  CLOSING_FLUSH_STEP,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  borrowSessionRamPassword,
  finishPlainOpen,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  parsePendingPlainConfirm,
  resolveVaultMountPoint,
  watchClosePhase,
  type VaultLifecycleService,
} from "@upriv/shared";
import {
  rpcVaultClose,
  rpcVaultCloseHurry,
  rpcVaultClosePhase,
  rpcVaultOpen,
  rpcVaultPlainConfirm,
} from "@/lib/rpc";

/** Session RAM only — never persist. */
const vaultPasswordInRam = new Map<string, string>();

/** Native → `upriv-ffi` `vault_open` / `vault_close`. */
export const nativeVaultLifecycleService: VaultLifecycleService = {
  hasPasswordInSession(vaultId) {
    return vaultPasswordInRam.has(vaultId);
  },

  setPasswordInSession(vaultId, password) {
    vaultPasswordInRam.set(vaultId, password);
  },

  clearPasswordInSession(vaultId) {
    vaultPasswordInRam.delete(vaultId);
  },

  openingStepCount: LIVE_OPENING_PIPELINE_STEP_COUNT,
  closingStepCount: LIVE_CLOSING_PIPELINE_STEP_COUNT,

  async runOpeningPipeline(vaultId, onStep) {
    onStep(0);
    const password = borrowSessionRamPassword(vaultPasswordInRam, vaultId);
    await finishPlainOpen({
      vaultId,
      password,
      open: rpcVaultOpen,
      confirm: rpcVaultPlainConfirm,
      close: (id) => rpcVaultClose(id, "user").then(() => undefined),
      pendingOf: parsePendingPlainConfirm,
    });
    // Hooks put the string back after a successful open.
    onStep(1);
  },

  async runClosingPipeline(vaultId, onStep, reason = "user") {
    onStep(CLOSING_FLUSH_STEP);
    const outcome = await watchClosePhase(
      rpcVaultClose(vaultId, reason),
      () => rpcVaultClosePhase(vaultId),
      () => onStep(CLOSING_BACKUP_STEP),
    );
    onStep(CLOSING_DONE_STEP);
    return outcome;
  },

  hurryClose(vaultId) {
    return rpcVaultCloseHurry(vaultId);
  },

  resolveWorkspacePath(displayName, parentPath) {
    return resolveVaultMountPoint(parentPath ?? "", displayName) ?? "";
  },

  validateLifecyclePassword(password) {
    return isLifecyclePasswordPresent(password);
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};
