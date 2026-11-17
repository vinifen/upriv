import {
  CLOSING_BACKUP_STEP,
  CLOSING_DONE_STEP,
  CLOSING_FLUSH_STEP,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  borrowSessionRamPassword,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  waitForClose,
  type VaultLifecycleService,
} from "@upriv/shared";
import {
  rpcPlainRecordForget,
  rpcVaultClose,
  rpcVaultCloseHurry,
  rpcVaultClosePhase,
  rpcVaultOpen,
} from "@/lib/rpc";

/** Session RAM only — never persist. */
const vaultPasswordInRam = new Map<string, string>();

/** Native → `upriv-ffi` `vault_open` / `vault_close`. A phone mounts no unlocked folder. */
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

  async runOpeningPipeline(vaultId, onStep, job) {
    onStep(0);
    const password = borrowSessionRamPassword(vaultPasswordInRam, vaultId);
    const switches = await rpcVaultOpen(vaultId, password, job);
    // Hooks put the string back after a successful open.
    onStep(1);
    return switches;
  },

  async runClosingPipeline(vaultId, onStep, reason = "user") {
    onStep(CLOSING_FLUSH_STEP);
    const outcome = await waitForClose(
      rpcVaultClose(vaultId, reason),
      () => rpcVaultClosePhase(vaultId),
      { onBackup: () => onStep(CLOSING_BACKUP_STEP) },
    );
    onStep(CLOSING_DONE_STEP);
    return outcome;
  },

  hurryClose(vaultId) {
    return rpcVaultCloseHurry(vaultId);
  },

  forgetPlainRecord(vaultId, token) {
    return rpcPlainRecordForget(vaultId, token);
  },

  validateLifecyclePassword(password) {
    return isLifecyclePasswordPresent(password);
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};
