import { describe, expect, it } from "vitest";
import {
  CORE_RPC_COMMANDS,
  CORE_RPC_TIMEOUT_MS,
  NO_DEADLINE_MS,
  OPERATION_LIMIT_MS,
  SHELL_ONLY_RPC_COMMANDS,
} from "@upriv/shared";
import { METHOD_TIMEOUT_MS } from "../invoke";

describe("METHOD_TIMEOUT_MS", () => {
  it("spreads CORE timeouts", () => {
    for (const method of Object.values(CORE_RPC_COMMANDS)) {
      expect(METHOD_TIMEOUT_MS[method]).toBe(CORE_RPC_TIMEOUT_MS[method]);
    }
  });

  it("waits with no deadline only for dialogs that wait for the person", () => {
    expect(METHOD_TIMEOUT_MS.pick_directory).toBe(NO_DEADLINE_MS);
    expect(METHOD_TIMEOUT_MS.pick_file).toBe(NO_DEADLINE_MS);
    expect(METHOD_TIMEOUT_MS.winfsp_install).toBe(NO_DEADLINE_MS);
    expect(METHOD_TIMEOUT_MS.fuse_install).toBe(NO_DEADLINE_MS);
  });

  it("leaves every other shell call on the one limit", () => {
    const waiting = new Set(["pick_directory", "pick_file", "winfsp_install", "fuse_install"]);
    for (const method of Object.values(SHELL_ONLY_RPC_COMMANDS)) {
      if (waiting.has(method)) continue;
      expect(METHOD_TIMEOUT_MS[method] ?? OPERATION_LIMIT_MS).toBe(OPERATION_LIMIT_MS);
    }
  });
});
