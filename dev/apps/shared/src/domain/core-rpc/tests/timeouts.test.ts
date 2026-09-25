import { describe, expect, it } from "vitest";
import { LOADING_BUDGET_MS } from "../../loading/budget";
import { CORE_RPC_COMMANDS } from "../commands";
import { CORE_RPC_TIMEOUT_MS } from "../timeouts";

describe("CORE_RPC_TIMEOUT_MS", () => {
  it("covers every CORE RPC and never uses 0", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      expect(CORE_RPC_TIMEOUT_MS[method], method).toEqual(expect.any(Number));
      expect(CORE_RPC_TIMEOUT_MS[method], method).toBeGreaterThan(0);
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
    expect(CORE_RPC_TIMEOUT_MS.vault_close).toBe(LOADING_BUDGET_MS.vaultPipeline);
    expect(CORE_RPC_TIMEOUT_MS.vault_rename).toBe(LOADING_BUDGET_MS.vaultRename);
    expect(CORE_RPC_TIMEOUT_MS.vault_export).toBe(LOADING_BUDGET_MS.vaultExport);
    expect(CORE_RPC_TIMEOUT_MS.vault_export_probe).toBe(LOADING_BUDGET_MS.vaultPipeline);
    expect(CORE_RPC_TIMEOUT_MS.vault_fs_import_os_file).toBe(LOADING_BUDGET_MS.vaultFsImport);
  });
});
