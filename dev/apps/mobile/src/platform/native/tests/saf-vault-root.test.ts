import { describe, expect, it, vi } from "vitest";
import { RpcError } from "@upriv/shared";

vi.mock("upriv-core", () => ({
  getUprivCoreNative: () => null,
}));

import { isSafTreeUri, toSafRpcError } from "../safVaultRoot";

describe("isSafTreeUri", () => {
  it("accepts content URIs and rejects filesystem paths", () => {
    expect(isSafTreeUri("content://tree/primary")).toBe(true);
    expect(isSafTreeUri("  content://tree/primary")).toBe(true);
    expect(isSafTreeUri("/storage/emulated/0")).toBe(false);
  });
});

describe("toSafRpcError", () => {
  it("passes RpcError through", () => {
    const error = new RpcError("vault_root_not_found", "missing");
    expect(toSafRpcError(error, "content://tree")).toBe(error);
  });

  it("extracts saf_* codes from wrapped Expo messages", () => {
    const error = toSafRpcError(
      new Error("module error: saf_unauthorized: tree not writable"),
      "content://tree",
    );
    expect(error.code).toBe("saf_unauthorized");
    expect(error.details).toEqual({ path: "content://tree" });
  });

  it("maps permission copy to saf_unauthorized", () => {
    const error = toSafRpcError(new Error("Permission denied for SAF tree"), "content://x");
    expect(error.code).toBe("saf_unauthorized");
  });

  it("maps cannot-create-.upriv copy to saf_create_failed", () => {
    const error = toSafRpcError(
      new Error("cannot create .upriv/ under the chosen folder"),
      "content://tree",
    );
    expect(error.code).toBe("saf_create_failed");
  });
});
