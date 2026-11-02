import { describe, expect, it } from "vitest";
import { LOADING_BUDGET_MS } from "../../loading/budget";
import { SIZED_BUDGET_CEILING_MS } from "../../loading/sizedBudget";
import { CORE_RPC_COMMANDS, MOBILE_ONLY_RPC_COMMANDS } from "../commands";
import {
  CORE_RPC_TIMEOUT_MS,
  MOBILE_ONLY_RPC_TIMEOUT_MS,
  vaultImportProbeTimeoutMs,
} from "../timeouts";

describe("CORE_RPC_TIMEOUT_MS", () => {
  it("covers every CORE and mobile-only RPC and never uses 0", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      expect(CORE_RPC_TIMEOUT_MS[method], method).toEqual(expect.any(Number));
      expect(CORE_RPC_TIMEOUT_MS[method], method).toBeGreaterThan(0);
    }
    for (const method of Object.values(MOBILE_ONLY_RPC_COMMANDS)) {
      expect(MOBILE_ONLY_RPC_TIMEOUT_MS[method], method).toBeGreaterThan(0);
    }
  });

  it("keeps user-visible waits on LOADING_BUDGET_MS", () => {
    expect(CORE_RPC_TIMEOUT_MS.vault_root_resolve).toBe(LOADING_BUDGET_MS.vaultRootResolve);
    expect(CORE_RPC_TIMEOUT_MS.vault_root_setup_default_root).toBe(LOADING_BUDGET_MS.vaultRoot);
    expect(CORE_RPC_TIMEOUT_MS.vault_root_setup_path).toBe(LOADING_BUDGET_MS.vaultRoot);
    expect(CORE_RPC_TIMEOUT_MS.vault_delete).toBe(LOADING_BUDGET_MS.vaultDelete);
    expect(CORE_RPC_TIMEOUT_MS.app_settings_get).toBe(LOADING_BUDGET_MS.settingsLoad);
    expect(CORE_RPC_TIMEOUT_MS.app_settings_save).toBe(LOADING_BUDGET_MS.settingsSave);
    expect(CORE_RPC_TIMEOUT_MS.log_list).toBe(LOADING_BUDGET_MS.logs);
    expect(CORE_RPC_TIMEOUT_MS.vault_group_list).toBe(LOADING_BUDGET_MS.default);
    expect(CORE_RPC_TIMEOUT_MS.vault_create).toBe(LOADING_BUDGET_MS.vaultCreate);
    expect(CORE_RPC_TIMEOUT_MS.vault_open).toBe(LOADING_BUDGET_MS.vaultPipeline);
    expect(CORE_RPC_TIMEOUT_MS.vault_rename).toBe(LOADING_BUDGET_MS.vaultRename);
    expect(CORE_RPC_TIMEOUT_MS.vault_fs_import_os_file).toBe(LOADING_BUDGET_MS.vaultFsImport);
    expect(CORE_RPC_TIMEOUT_MS.vault_import_probe).toBe(LOADING_BUDGET_MS.default);
    expect(vaultImportProbeTimeoutMs({ kind: "seven_zip" })).toBe(LOADING_BUDGET_MS.vaultCreate);
    expect(vaultImportProbeTimeoutMs({ kind: "7z" })).toBe(LOADING_BUDGET_MS.vaultCreate);
    expect(vaultImportProbeTimeoutMs({ archivePath: "/tmp/notes.7z" })).toBe(
      LOADING_BUDGET_MS.vaultCreate,
    );
    expect(vaultImportProbeTimeoutMs({ kind: "store_zip", archivePath: "/tmp/notes.7z" })).toBe(
      LOADING_BUDGET_MS.default,
    );
  });

  it("lets work sized while it runs reach the ceiling, so its visible budget ends the wait", () => {
    for (const method of [
      CORE_RPC_COMMANDS.VAULT_CLOSE,
      CORE_RPC_COMMANDS.VAULT_PLAIN_REMOVE,
      CORE_RPC_COMMANDS.VAULT_EXPORT,
      CORE_RPC_COMMANDS.BACKUP_SAVE,
      CORE_RPC_COMMANDS.BACKUP_EXPORT,
      CORE_RPC_COMMANDS.DATA_FOLDER_EXPORT,
    ]) {
      expect(CORE_RPC_TIMEOUT_MS[method], method).toBe(SIZED_BUDGET_CEILING_MS);
    }
  });

  it("keeps the floor for work sized before it starts; the caller passes the sized budget", () => {
    expect(CORE_RPC_TIMEOUT_MS.vault_change_password).toBe(LOADING_BUDGET_MS.vaultRewrap);
    expect(CORE_RPC_TIMEOUT_MS.vault_change_kdf).toBe(LOADING_BUDGET_MS.vaultRewrap);
  });
});
