import {
  CLOSING_BACKUP_STEP,
  CLOSING_DONE_STEP,
  CLOSING_FLUSH_STEP,
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  borrowSessionRamPassword,
  currentWorkspaceSystem,
  encryptedShortcutActive,
  finishPlainOpen,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  parsePendingPlainConfirm,
  resolveVaultMountPoint,
  watchClosePhase,
  type VaultLifecycleService,
} from "@upriv/shared";
import { isElectronRenderer } from "@/lib/invoke";
import {
  rpcAppSettingsGet,
  rpcVaultClose,
  rpcVaultClosePhase,
  rpcVaultConfigGet,
  rpcVaultOpen,
  rpcVaultPlainConfirm,
  rpcWinFspInstall,
  rpcWinFspStatus,
} from "@/lib/rpc";

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
    await installWinFspWhenFolderNeeded(vaultId);
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

/**
 * A vault that already wants the file manager folder asks for the driver here.
 * Declining leaves the saved switch unchanged and the vault still opens in the app.
 */
async function installWinFspWhenFolderNeeded(vaultId: string): Promise<void> {
  if (currentWorkspaceSystem() !== "windows" || !isElectronRenderer()) return;
  try {
    const status = await rpcWinFspStatus();
    if (!status.applicable || status.installed) return;
    const [app, vault] = await Promise.all([rpcAppSettingsGet(), rpcVaultConfigGet(vaultId)]);
    if (vault.storage.mode !== "encrypted_dir") return;
    if (!encryptedShortcutActive(app.settings.workspace, vault.mount, "windows")) return;
    await rpcWinFspInstall();
  } catch {
    // Open continues. A missing driver leaves the in-app file manager.
  }
}
