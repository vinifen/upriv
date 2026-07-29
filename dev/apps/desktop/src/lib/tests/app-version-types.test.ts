import { describe, expect, it } from "vitest";
import { BRIDGE_ERROR_CODES, RpcError } from "../errors";
import { isAppVersionResult, parseAppVersionResult } from "../types";

describe("isAppVersionResult", () => {
  it("accepts version-only and known distributions", () => {
    expect(isAppVersionResult({ version: "0.1.0-beta" })).toBe(true);
    expect(isAppVersionResult({ version: "1.0.0", distribution: "portable" })).toBe(true);
    expect(isAppVersionResult({ version: "1.0.0", distribution: "installed" })).toBe(true);
    expect(isAppVersionResult({ version: "1.0.0", distribution: "dev" })).toBe(true);
  });

  it("rejects invalid shapes", () => {
    expect(isAppVersionResult(null)).toBe(false);
    expect(isAppVersionResult({ version: 1 })).toBe(false);
    expect(isAppVersionResult({ version: "1", distribution: "nightly" })).toBe(false);
  });
});

describe("parseAppVersionResult", () => {
  it("returns valid payloads", () => {
    expect(parseAppVersionResult({ version: "0.1.0-beta", distribution: "dev" })).toEqual({
      version: "0.1.0-beta",
      distribution: "dev",
    });
  });

  it("throws RpcError invalid_response for bad payloads", () => {
    try {
      parseAppVersionResult({ version: 9 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      expect((error as RpcError).code).toBe(BRIDGE_ERROR_CODES.INVALID_RESPONSE);
    }
  });
});
