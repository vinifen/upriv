import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseVaultRootInspect } from "../parse";
import { sameVaultRootPath, vaultRootPathKey } from "../pathKey";

describe("parseVaultRootInspect", () => {
  it("parses a valid inspect payload", () => {
    expect(parseVaultRootInspect({ status: "incomplete", path: "/data" })).toEqual({
      status: "incomplete",
      path: "/data",
    });
  });

  it("rejects a missing path", () => {
    expect(() => parseVaultRootInspect({ status: "valid" })).toThrow(RpcError);
  });
});

describe("vaultRootPathKey", () => {
  it("trims trailing slashes so Windows and POSIX roots compare equal", () => {
    expect(vaultRootPathKey("/data/.upriv/")).toBe("/data/.upriv");
    expect(sameVaultRootPath("/data/.upriv/", "/data/.upriv")).toBe(true);
    expect(sameVaultRootPath("C:\\Upriv\\", "C:\\Upriv")).toBe(true);
  });
});
