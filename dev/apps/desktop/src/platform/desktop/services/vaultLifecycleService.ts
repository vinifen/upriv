import {
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  WORKSPACE_PATH_DEFAULT,
  borrowSessionRamPassword,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  resolveVaultMountPoint,
  type VaultLifecycleService,
} from "@upriv/shared";
import { rpcVaultClose, rpcVaultOpen } from "@/lib/rpc";

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
    onStep(0);
    const password = vaultPasswordInRam.get(vaultId);
    await rpcVaultClose(vaultId, password);
    onStep(1);
  },

  resolveWorkspacePath(displayName, options) {
    return (
      resolveVaultMountPoint(
        options?.globalWorkspacePath ?? "",
        options?.mountWorkspacePath ?? WORKSPACE_PATH_DEFAULT,
        displayName,
      ) ?? ""
    );
  },

  validateLifecyclePassword(password) {
    return isLifecyclePasswordPresent(password);
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};
