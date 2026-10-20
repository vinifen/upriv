import { describe, expect, it } from "vitest";
import { BRIDGE_ERROR_CODES, RpcError } from "../errors";
import { isElectronRenderer, parseInvokeFailure } from "../invoke";

describe("parseInvokeFailure", () => {
  it("passes through RpcError", () => {
    const err = new RpcError(BRIDGE_ERROR_CODES.RPC_TIMEOUT, "already");
    expect(parseInvokeFailure(err)).toBe(err);
  });

  it("parses daemon wire format from Error.message", () => {
    const err = parseInvokeFailure(
      new Error("Error invoking remote method 'x': Error: vault_locked: not open"),
    );
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe("vault_locked");
    expect(err.message).toBe("not open");
  });

  it("parses the main-process rpc_timeout message", () => {
    const err = parseInvokeFailure(
      new Error("Error invoking remote method 'x': Error: rpc_timeout: daemon RPC timeout: x"),
    );
    expect(err.code).toBe(BRIDGE_ERROR_CODES.RPC_TIMEOUT);
    expect(err.message).toBe("daemon RPC timeout: x");
  });

  it("keeps multiline daemon messages", () => {
    const err = parseInvokeFailure(
      new Error("Error invoking remote method 'x': Error: invalid_config: line 1\nline 2"),
    );
    expect(err.code).toBe("invalid_config");
    expect(err.message).toBe("line 1\nline 2");
  });

  it("wraps plain Error without wire format", () => {
    const err = parseInvokeFailure(new Error("preload boom"));
    expect(err.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED);
    expect(err.message).toBe("preload boom");
  });

  it("maps daemon-process-down messages to daemon_unavailable", () => {
    const exited = parseInvokeFailure(new Error("upriv-daemon exited (code 1)"));
    expect(exited.code).toBe(BRIDGE_ERROR_CODES.DAEMON_UNAVAILABLE);
    const down = parseInvokeFailure(new Error("upriv-daemon is not running"));
    expect(down.code).toBe(BRIDGE_ERROR_CODES.DAEMON_UNAVAILABLE);
  });

  it("wraps non-Error values", () => {
    const err = parseInvokeFailure("string fail");
    expect(err.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED);
    expect(err.message).toBe("string fail");
  });
});

describe("isElectronRenderer", () => {
  it("is false without window.upriv", () => {
    expect(isElectronRenderer()).toBe(false);
  });
});
