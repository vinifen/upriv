import {
  CLOSING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
  VaultPipelineError,
  isVaultPipelineError,
  runTimedPipeline,
  type VaultLifecycleService,
} from "@upriv/shared";
import { MOCK_UPRIV_ROOT_PATH } from "@/platform/mocks/data/appSettings";

const vaultPasswordInRam = new Map<string, string>();
const seededOpenVaultIds = new Set<string>();

function getPasswordInRam(vaultId: string): string | undefined {
  return vaultPasswordInRam.get(vaultId);
}

/** Demo vault that always fails open with insufficient RAM (RF-04c). */
function mockOpenRamFails(vaultId: string): boolean {
  return vaultId === "cold-storage";
}

/** Demo: unlock with password `gatefail` → close aborts at 7z t gate (RF-05). */
function mockCloseGateFails(vaultId: string): boolean {
  return getPasswordInRam(vaultId) === "gatefail";
}

/** Prototype lifecycle service — RAM password map and timed pipelines until Tauri wiring. */
export const mockVaultLifecycleService: VaultLifecycleService = {
  hasPasswordInSession(vaultId) {
    return vaultPasswordInRam.has(vaultId);
  },

  setPasswordInSession(vaultId, password) {
    vaultPasswordInRam.set(vaultId, password.trim());
  },

  clearPasswordInSession(vaultId) {
    vaultPasswordInRam.delete(vaultId);
  },

  seedInitialOpenVaultPasswords(openVaultIds) {
    for (const vaultId of openVaultIds) {
      if (seededOpenVaultIds.has(vaultId)) continue;
      if (!vaultPasswordInRam.has(vaultId)) {
        vaultPasswordInRam.set(vaultId, "demo");
      }
      seededOpenVaultIds.add(vaultId);
    }
  },

  validatePassword(password) {
    const trimmed = password.trim();
    return trimmed.length > 0 && trimmed !== "wrong";
  },

  openingStepCount: OPENING_PIPELINE_STEP_COUNT,
  closingStepCount: CLOSING_PIPELINE_STEP_COUNT,

  async runOpeningPipeline(vaultId, onStep) {
    await runTimedPipeline(OPENING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
      if (stepIndex === 2 && mockOpenRamFails(vaultId)) {
        throw new VaultPipelineError("error.insufficient_ram");
      }
    });
  },

  async runClosingPipeline(vaultId, onStep) {
    await runTimedPipeline(CLOSING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
      if (stepIndex === 0 && mockCloseGateFails(vaultId)) {
        throw new VaultPipelineError("error.archive_test_failed");
      }
    });
  },

  resolveWorkspacePath(displayName) {
    return `${MOCK_UPRIV_ROOT_PATH}/workspace/${displayName}`;
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};
