import { describe, expect, it } from "vitest";
import { CORE_RPC_COMMANDS, CORE_RPC_TIMEOUT_MS, LOADING_BUDGET_MS } from "@upriv/shared";
import { METHOD_TIMEOUT_MS } from "../invoke";

describe("METHOD_TIMEOUT_MS", () => {
  it("spreads CORE timeouts and leaves native pickers unbounded", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      expect(METHOD_TIMEOUT_MS[method]).toBe(CORE_RPC_TIMEOUT_MS[method]);
    }
    expect(METHOD_TIMEOUT_MS.pick_directory).toBe(0);
    expect(METHOD_TIMEOUT_MS.pick_file).toBe(0);
    expect(METHOD_TIMEOUT_MS.pick_save_file).toBe(0);
    expect(METHOD_TIMEOUT_MS.reveal_in_file_manager).toBe(10_000);
    expect(METHOD_TIMEOUT_MS.open_in_terminal).toBe(10_000);
    expect(METHOD_TIMEOUT_MS.app_shutdown).toBe(LOADING_BUDGET_MS.vaultPipeline);
    expect(METHOD_TIMEOUT_MS.app_exit).toBe(LOADING_BUDGET_MS.vaultPipeline);
    expect(METHOD_TIMEOUT_MS.vault_root_setup_path).toBeGreaterThan(0);
  });
});
