import { describe, expect, it } from "vitest";
import { BRIDGE_ERROR_CODES, RpcError } from "../errors";
import { isDesktop, isElectronRenderer, parseInvokeFailure } from "../invoke";

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

  it("maps legacy timeout: to rpc_timeout", () => {
    const err = parseInvokeFailure(
      new Error("Error invoking remote method 'x': Error: timeout: slow"),
    );
    expect(err.code).toBe(BRIDGE_ERROR_CODES.RPC_TIMEOUT);
    expect(err.message).toBe("slow");
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

  it("wraps non-Error values", () => {
    const err = parseInvokeFailure("string fail");
    expect(err.code).toBe(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED);
    expect(err.message).toBe("string fail");
  });
});

describe("isElectronRenderer / isDesktop", () => {
  it("is false without window.upriv", () => {
    expect(isElectronRenderer()).toBe(false);
    expect(isDesktop()).toBe(false);
  });
});
