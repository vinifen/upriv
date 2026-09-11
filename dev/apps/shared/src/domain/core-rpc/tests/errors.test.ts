import { describe, expect, it } from "vitest";
import { parseRpcErrorBody, RpcError, isRpcError } from "../errors";

describe("RpcError duck typing", () => {
  it("accepts RpcError and rejects a plain Error", () => {
    const error = new RpcError("invalid_request", "bad");
    expect(isRpcError(error)).toBe(true);
    expect(isRpcError(new Error("nope"))).toBe(false);
  });

  it("parses a wire error body", () => {
    expect(parseRpcErrorBody({ code: "io_error", message: "disk" })).toEqual({
      code: "io_error",
      message: "disk",
    });
    expect(parseRpcErrorBody({ code: 1 })).toBeNull();
  });
});
