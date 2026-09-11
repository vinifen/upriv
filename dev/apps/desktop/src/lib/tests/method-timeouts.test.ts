import { describe, expect, it } from "vitest";
import { CORE_RPC_COMMANDS, CORE_RPC_TIMEOUT_MS } from "@upriv/shared";
import { METHOD_TIMEOUT_MS } from "../invoke";

describe("METHOD_TIMEOUT_MS", () => {
  it("spreads CORE timeouts and leaves pick_directory unbounded", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      expect(METHOD_TIMEOUT_MS[method]).toBe(CORE_RPC_TIMEOUT_MS[method]);
    }
    expect(METHOD_TIMEOUT_MS.pick_directory).toBe(0);
    expect(METHOD_TIMEOUT_MS.app_shutdown).toBe(5_000);
    expect(METHOD_TIMEOUT_MS.app_exit).toBe(15_000);
    expect(METHOD_TIMEOUT_MS.vault_root_setup_path).toBeGreaterThan(0);
  });
});
