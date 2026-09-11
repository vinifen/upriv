import {
  CLOSING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
  VAULT_PIPELINE_ERROR_CODES,
  VaultPipelineError,
  WORKSPACE_PATH_DEFAULT,
  isMockLifecyclePasswordValid,
  isVaultPipelineError,
  resolveVaultMountPoint,
  runTimedPipeline,
  type VaultLifecycleService,
} from "@upriv/shared";
import { recordMockVaultOpened } from "@upriv/shared/testing";
import { getMockAppSettings } from "@/platform/mocks/data/appSettings";

/** Prototype-only RAM session store — never use as a production security model. */
const vaultPasswordInRam = new Map<string, string>();

function getPasswordInRam(vaultId: string): string | undefined {
  return vaultPasswordInRam.get(vaultId);
}

/** Demo vault that always fails open with insufficient RAM (RF-04c). */
function mockOpenRamFails(vaultId: string): boolean {
  return vaultId === "cold-storage";
}

/** Demo: unlock with password `gatefail` → close aborts at vault.header test. */
function mockCloseGateFails(vaultId: string): boolean {
  return getPasswordInRam(vaultId) === "gatefail";
}

/** Prototype lifecycle service — RAM password map and timed pipelines until desktop wiring. */
export const mockVaultLifecycleService: VaultLifecycleService = {
  hasPasswordInSession(vaultId) {
    return vaultPasswordInRam.has(vaultId);
  },

  setPasswordInSession(vaultId, password) {
    vaultPasswordInRam.set(vaultId, password);
  },

  clearPasswordInSession(vaultId) {
    vaultPasswordInRam.delete(vaultId);
  },

  openingStepCount: OPENING_PIPELINE_STEP_COUNT,
  closingStepCount: CLOSING_PIPELINE_STEP_COUNT,

  async runOpeningPipeline(vaultId, onStep) {
    await runTimedPipeline(OPENING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
      if (stepIndex === 2 && mockOpenRamFails(vaultId)) {
        throw new VaultPipelineError(VAULT_PIPELINE_ERROR_CODES.INSUFFICIENT_RAM);
      }
    });
    recordMockVaultOpened(vaultId);
  },

  async runClosingPipeline(vaultId, onStep) {
    await runTimedPipeline(CLOSING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
      if (stepIndex === 0 && mockCloseGateFails(vaultId)) {
        throw new VaultPipelineError(VAULT_PIPELINE_ERROR_CODES.HEADER_TEST_FAILED);
      }
    });
  },

  resolveWorkspacePath(displayName, options) {
    return (
      resolveVaultMountPoint(
        options?.globalWorkspacePath ?? getMockAppSettings().workspace.path,
        options?.mountWorkspacePath ?? WORKSPACE_PATH_DEFAULT,
        displayName,
      ) ?? ""
    );
  },

  validateLifecyclePassword(password) {
    return isMockLifecyclePasswordValid(password);
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};

/** Desktop mock helper — not part of the shared service contract. */
export function validateMockLifecyclePassword(password: string): boolean {
  return isMockLifecyclePasswordValid(password);
}

/** Desktop mock helper — not part of the shared service contract. */
export function seedDemoOpenVaultPasswords(
  openVaultIds: readonly string[],
  getPasswordHint?: (vaultId: string) => string | undefined,
): void {
  for (const vaultId of openVaultIds) {
    if (vaultPasswordInRam.has(vaultId)) continue;
    const hint = getPasswordHint?.(vaultId)?.trim();
    if (hint) {
      vaultPasswordInRam.set(vaultId, hint);
    }
  }
}
