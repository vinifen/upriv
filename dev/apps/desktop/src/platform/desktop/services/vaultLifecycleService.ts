import {
  CLOSING_BACKUP_STEP,
  CLOSING_DONE_STEP,
  CLOSING_FLUSH_STEP,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  borrowSessionRamPassword,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  resolveVaultMountPoint,
  watchClosePhase,
  type VaultLifecycleService,
} from "@upriv/shared";
import { rpcVaultClose, rpcVaultClosePhase, rpcVaultOpen } from "@/lib/rpc";

/** Session RAM only — never persist. */
const vaultPasswordInRam = new Map<string, string>();

/** Desktop → daemon `vault_open` / `vault_close`. */
export const desktopVaultLifecycleService: VaultLifecycleService = {
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
    await rpcVaultOpen(vaultId, password);
    // Do not put the string back here — hooks restore only for modes that
    // may lock without retyping (`shouldRetainSessionRamPassword`).
    onStep(1);
  },

  async runClosingPipeline(vaultId, onStep) {
    onStep(CLOSING_FLUSH_STEP);
    const password = vaultPasswordInRam.get(vaultId);
    const outcome = await watchClosePhase(
      rpcVaultClose(vaultId, password),
      () => rpcVaultClosePhase(vaultId),
      () => onStep(CLOSING_BACKUP_STEP),
    );
    onStep(CLOSING_DONE_STEP);
    return outcome;
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
