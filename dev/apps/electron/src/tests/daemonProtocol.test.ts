import { describe, expect, it } from "vitest";
import {
  CORE_RPC_COMMANDS,
  DESKTOP_ONLY_RPC_COMMANDS,
  SHELL_ONLY_RPC_COMMANDS,
} from "../../../shared/src/domain/core-rpc/commands";
import { ELECTRON_IPC_METHODS } from "../ipcMethods";
import {
  MAX_STDOUT_BUFFER_CHARS,
  formatRpcError,
  parseDaemonStdoutLine,
  rpcTimeoutErrorMessage,
  shouldArmRpcTimeout,
  stdoutBufferExceeded,
} from "../daemonProtocol";

describe("ELECTRON_IPC_METHODS", () => {
  it("is the union of CORE + desktop-only + shell-only", () => {
    expect([...ELECTRON_IPC_METHODS].sort()).toEqual(
      [
        ...Object.values(CORE_RPC_COMMANDS),
        ...Object.values(DESKTOP_ONLY_RPC_COMMANDS),
        ...Object.values(SHELL_ONLY_RPC_COMMANDS),
      ].sort(),
    );
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

  it("flags an oversized stdout buffer", () => {
    expect(stdoutBufferExceeded(MAX_STDOUT_BUFFER_CHARS)).toBe(false);
    expect(stdoutBufferExceeded(MAX_STDOUT_BUFFER_CHARS + 1)).toBe(true);
  });
});
