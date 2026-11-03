import { describe, expect, it } from "vitest";
import {
  CORE_RPC_COMMANDS,
  SHELL_ONLY_RPC_COMMANDS,
} from "../../../shared/src/domain/core-rpc/commands";
import contract from "../../../shared/src/domain/core-rpc/tests/rpc-methods.json";
import { OPERATION_LIMIT_MS } from "../../../shared/src/domain/loading/limits";
import { ELECTRON_IPC_METHODS } from "../ipcMethods";
import {
  DEFAULT_RPC_TIMEOUT_MS,
  MAX_STDOUT_BUFFER_CHARS,
  SHUTDOWN_METHOD,
  SHUTDOWN_NOW_TIMEOUT_MS,
  formatRpcError,
  parseDaemonStdoutLine,
  rpcTimeoutErrorMessage,
  settleInvoke,
  shouldArmRpcTimeout,
  stdoutBufferExceeded,
} from "../daemonProtocol";

describe("ELECTRON_IPC_METHODS", () => {
  it("is the union of CORE + shell-only", () => {
    expect([...ELECTRON_IPC_METHODS].sort()).toEqual(
      [...Object.values(CORE_RPC_COMMANDS), ...Object.values(SHELL_ONLY_RPC_COMMANDS)].sort(),
    );
  });

  it("shuts the daemon down with its desktop-only method, which the renderer cannot send", () => {
    expect(contract.desktopOnly).toEqual([SHUTDOWN_METHOD]);
    expect(ELECTRON_IPC_METHODS).not.toContain(SHUTDOWN_METHOD);
  });
});

describe("daemon protocol helpers", () => {
  it("formats wire errors as code: message", () => {
    expect(formatRpcError({ code: "vault_locked", message: "not open" }, "fallback")).toBe(
      "vault_locked: not open",
    );
    expect(formatRpcError(undefined, "daemon RPC failed")).toBe("daemon RPC failed");
  });

  it("arms timeouts only when timeoutMs is positive", () => {
    expect(shouldArmRpcTimeout(0)).toBe(false);
    expect(shouldArmRpcTimeout(-1)).toBe(false);
    expect(shouldArmRpcTimeout(30_000)).toBe(true);
    expect(rpcTimeoutErrorMessage("log_list")).toBe("rpc_timeout: daemon RPC timeout: log_list");
  });

  it("parses NDJSON lines and ignores garbage", () => {
    expect(parseDaemonStdoutLine("")).toBeNull();
    expect(parseDaemonStdoutLine("not-json")).toBeNull();
    expect(parseDaemonStdoutLine('{"type":"ready"}')).toEqual({ type: "ready" });
  });

  it("waits for a call with no timeout of its own as long as the shared operation limit", () => {
    expect(DEFAULT_RPC_TIMEOUT_MS).toBe(OPERATION_LIMIT_MS);
  });

  it("gives the quit's Close now a short, finite wait", () => {
    expect(shouldArmRpcTimeout(SHUTDOWN_NOW_TIMEOUT_MS)).toBe(true);
    expect(SHUTDOWN_NOW_TIMEOUT_MS).toBeLessThan(OPERATION_LIMIT_MS);
  });

  it("flags an oversized stdout buffer", () => {
    expect(stdoutBufferExceeded(MAX_STDOUT_BUFFER_CHARS)).toBe(false);
    expect(stdoutBufferExceeded(MAX_STDOUT_BUFFER_CHARS + 1)).toBe(true);
  });

  it("answers a failed invoke with its wire text instead of throwing", async () => {
    await expect(settleInvoke(async () => ({ id: "notes" }))).resolves.toEqual({
      ok: true,
      value: { id: "notes" },
    });
    await expect(
      settleInvoke(async () => {
        throw new Error("wrong_password: wrong password");
      }),
    ).resolves.toEqual({ ok: false, error: "wrong_password: wrong password" });
  });
});
