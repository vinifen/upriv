import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseDefaultRootStatus, parseVaultRootResolve } from "../parse";

describe("parseVaultRootResolve", () => {
  it("parses a found payload", () => {
    expect(
      parseVaultRootResolve({
        status: "found",
        rootPath: "/data",
        source: "default_root",
      }),
    ).toEqual({ status: "found", rootPath: "/data", source: "default_root" });
  });

  it("rejects an unknown status", () => {
    expect(() => parseVaultRootResolve({ status: "nope" })).toThrow(RpcError);
  });
});

describe("parseDefaultRootStatus", () => {
  it("parses a valid status", () => {
    expect(parseDefaultRootStatus({ status: "valid", defaultRootAnchor: "/home" })).toEqual({
      status: "valid",
      defaultRootAnchor: "/home",
    });
  });
});
