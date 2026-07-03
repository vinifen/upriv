import {
  CLOSING_PIPELINE_STEP_COUNT,
  LIFECYCLE_PIPELINE_STEP_MS,
  OPENING_PIPELINE_STEP_COUNT,
  VaultPipelineError,
  isVaultPipelineError,
  type VaultLifecycleService,
  type VaultPipelineErrorCode,
} from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { mockVaultLifecycleService } from "@/platform/mocks/services/vaultLifecycleService";
import { getVaultStorageMode } from "./vaultService";
import { resolveVaultRootPath } from "./vaultRoot";
import { flushWorkspace, hydrateWorkspace, stopWorkspaceWatch } from "./workspaceFsStore";
import type { RawVaultConfig } from "./mapVaultConfig";

const vaultPasswordInRam = new Map<string, string>();
const workspacePathByVaultId = new Map<string, string>();
const workspaceMountKindByVaultId = new Map<string, string>();

export type WorkspaceMountKindLabel = "virtual_fuse" | "dev_plaintext";

interface EncryptedVaultOpenResult {
  workspace: string;
  mountKind: WorkspaceMountKindLabel;
  fuseVerified: boolean;
}

export function getWorkspaceMountKind(vaultId: string): WorkspaceMountKindLabel | null {
  const kind = workspaceMountKindByVaultId.get(vaultId);
  if (kind === "virtual_fuse" || kind === "dev_plaintext") return kind;
  return null;
}

async function tryRestorePasswordFromDisk(
  vaultId: string,
  vaultRoot: string,
): Promise<string | undefined> {
  const cached = vaultPasswordInRam.get(vaultId);
  if (cached) return cached;

  try {
    const exists = await tauriInvoke<boolean>(TAURI_COMMANDS.VAULT_DISK_SESSION_EXISTS, {
      vaultRoot,
      vaultId,
    });
    if (!exists) return undefined;

    const password = await tauriInvoke<string>(TAURI_COMMANDS.VAULT_DISK_SESSION_READ, {
      vaultRoot,
      vaultId,
      password: null,
    });
    if (password) {
      vaultPasswordInRam.set(vaultId, password);
      return password;
    }
  } catch {
    // disk session missing or unreadable
  }
  return undefined;
}

async function vaultSecurityMode(
  vaultRoot: string,
  vaultId: string,
): Promise<string | undefined> {
  try {
    const config = await tauriInvoke<RawVaultConfig>(TAURI_COMMANDS.VAULT_CONFIG_GET, {
      vaultRoot,
      vaultId,
    });
    return config.security?.mode;
  } catch {
    return undefined;
  }
}

function mapInvokeError(error: unknown): VaultPipelineError {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "error.archive_test_failed";

  const code: VaultPipelineErrorCode =
    message === "error.insufficient_ram" ||
    message === "error.archive_test_failed" ||
    message === "error.archive_test_failed_open" ||
    message === "error.fuse_unavailable" ||
    message === "error.vault_already_open"
      ? message
      : "error.archive_test_failed";

  return new VaultPipelineError(code);
}

/**
 * Run the real (single, blocking) Tauri operation while animating the named
 * pipeline steps on a timer. Real `7zz` work gives no per-step progress, so the
 * overlay would otherwise sit frozen on step 0; here it advances up to the last
 * step (kept "active") until the work resolves, then snaps to completion.
 */
async function runLifecyclePipelineSteps(
  stepCount: number,
  onStep: (stepIndex: number) => void,
  work: () => Promise<void>,
): Promise<void> {
  let currentStep = 0;
  onStep(0);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const scheduleNext = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      // Hold on the final step (pulsing) until the real work finishes.
      if (currentStep < stepCount - 1) {
        currentStep += 1;
        onStep(currentStep);
        scheduleNext();
      }
    }, LIFECYCLE_PIPELINE_STEP_MS);
  };
  scheduleNext();

  try {
    await work();
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
  }

  // Success: ensure the remaining steps render as completed.
  for (let index = currentStep + 1; index < stepCount; index += 1) {
    onStep(index);
  }
}

function lifecycleCommands(storageMode: "plain" | "encrypted_dir") {
  if (storageMode === "plain") {
    return {
      open: TAURI_COMMANDS.PLAIN_VAULT_OPEN,
      close: TAURI_COMMANDS.PLAIN_VAULT_CLOSE,
    };
  }
  return {
    open: TAURI_COMMANDS.ENCRYPTED_VAULT_OPEN,
    close: TAURI_COMMANDS.ENCRYPTED_VAULT_CLOSE,
  };
}

export function createTauriVaultLifecycleService(): VaultLifecycleService {
  return {
    hasPasswordInSession(vaultId) {
      return vaultPasswordInRam.has(vaultId);
    },

    getPasswordInSession(vaultId) {
      return vaultPasswordInRam.get(vaultId) ?? null;
    },

    setPasswordInSession(vaultId, password) {
      vaultPasswordInRam.set(vaultId, password.trim());
    },

    clearPasswordInSession(vaultId) {
      vaultPasswordInRam.delete(vaultId);
      workspacePathByVaultId.delete(vaultId);
      workspaceMountKindByVaultId.delete(vaultId);
    },

    async hasDiskSession(vaultId) {
      try {
        const vaultRoot = await resolveVaultRootPath();
        return await tauriInvoke<boolean>(TAURI_COMMANDS.VAULT_DISK_SESSION_EXISTS, {
          vaultRoot,
          vaultId,
        });
      } catch {
        return false;
      }
    },

    openingStepCount: OPENING_PIPELINE_STEP_COUNT,
    closingStepCount: CLOSING_PIPELINE_STEP_COUNT,

    async runOpeningPipeline(vaultId, onStep) {
      const storageMode = getVaultStorageMode(vaultId);
      if (storageMode !== "plain" && storageMode !== "encrypted_dir") {
        return mockVaultLifecycleService.runOpeningPipeline(vaultId, onStep);
      }

      const vaultRoot = await resolveVaultRootPath();
      let password = vaultPasswordInRam.get(vaultId);
      if (!password) {
        const mode = await vaultSecurityMode(vaultRoot, vaultId);
        if (mode === "disk_open_close") {
          password = await tryRestorePasswordFromDisk(vaultId, vaultRoot);
        }
      }
      if (!password) {
        throw new VaultPipelineError("error.archive_test_failed");
      }

      const commands = lifecycleCommands(storageMode);

      await runLifecyclePipelineSteps(OPENING_PIPELINE_STEP_COUNT, onStep, async () => {
        try {
          const result = await tauriInvoke<EncryptedVaultOpenResult | string>(commands.open, {
            vaultRoot,
            vaultId,
            password,
          });
          if (typeof result === "string") {
            workspacePathByVaultId.set(vaultId, result);
            workspaceMountKindByVaultId.delete(vaultId);
          } else {
            workspacePathByVaultId.set(vaultId, result.workspace);
            workspaceMountKindByVaultId.set(vaultId, result.mountKind);
          }
          await hydrateWorkspace(vaultId, vaultRoot);
        } catch (error) {
          throw mapInvokeError(error);
        }
      });
    },

    async runClosingPipeline(vaultId, onStep, seal = false) {
      const storageMode = getVaultStorageMode(vaultId);
      if (storageMode !== "plain" && storageMode !== "encrypted_dir") {
        return mockVaultLifecycleService.runClosingPipeline(vaultId, onStep, seal);
      }

      const vaultRoot = await resolveVaultRootPath();
      let password = vaultPasswordInRam.get(vaultId);
      if (!password) {
        const mode = await vaultSecurityMode(vaultRoot, vaultId);
        if (mode === "disk_open_close") {
          password = await tryRestorePasswordFromDisk(vaultId, vaultRoot);
        }
      }

      // Seal directly from `closed` (no active session, no password): just drop the
      // encrypted store cache — the `.7z` was already rebuilt at the last close.
      if (seal && storageMode === "encrypted_dir" && !password) {
        await runLifecyclePipelineSteps(CLOSING_PIPELINE_STEP_COUNT, onStep, async () => {
          try {
            await tauriInvoke(TAURI_COMMANDS.ENCRYPTED_VAULT_SEAL_CLOSED, {
              vaultRoot,
              vaultId,
            });
            await stopWorkspaceWatch(vaultId);
            workspacePathByVaultId.delete(vaultId);
          } catch (error) {
            throw mapInvokeError(error);
          }
        });
        return;
      }

      if (!password) {
        throw new VaultPipelineError("error.archive_test_failed");
      }

      const commands = lifecycleCommands(storageMode);

      await runLifecyclePipelineSteps(CLOSING_PIPELINE_STEP_COUNT, onStep, async () => {
        try {
          // Persist any in-app file-manager edits to the workspace before sealing.
          await flushWorkspace(vaultId);
          await stopWorkspaceWatch(vaultId);
          await tauriInvoke(commands.close, {
            vaultRoot,
            vaultId,
            password,
            seal,
          });
          workspacePathByVaultId.delete(vaultId);
        } catch (error) {
          throw mapInvokeError(error);
        }
      });
    },

    resolveWorkspacePath(displayName) {
      for (const path of workspacePathByVaultId.values()) {
        if (path.endsWith(`/${displayName}`) || path.endsWith(displayName)) {
          return path;
        }
      }
      return mockVaultLifecycleService.resolveWorkspacePath(displayName);
    },

    isPipelineError: isVaultPipelineError,

    pipelineErrorCode(error) {
      return error.code;
    },
  };
}

/** @internal Test hook */
export function __clearTauriLifecycleStateForTests(): void {
  vaultPasswordInRam.clear();
  workspacePathByVaultId.clear();
}
