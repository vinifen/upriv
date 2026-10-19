import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "@upriv/shared";

const native = vi.hoisted(() => ({
  current: null as null | {
    mountSafRoot?: (uri: string) => void;
    mountSafExport?: (uri: string) => void;
  },
}));

vi.mock("upriv-core", () => ({
  getUprivCoreNative: () => native.current,
}));

import { isSafTreeUri, mountSafExport, mountSafRoot, toSafRpcError } from "../safVaultRoot";

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
});

describe("mountSafRoot", () => {
  beforeEach(() => {
    native.current = null;
  });

  it("turns an unplugged drive into vault_root_unreachable with the tree path", () => {
    native.current = {
      mountSafRoot: () => {
        throw new Error(
          "Call to function 'UprivCore.mountSafRoot' has been rejected. saf_unreachable",
        );
      },
    };
    let caught: unknown;
    try {
      mountSafRoot("content://usb/tree/A1B2");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect(caught).toMatchObject({
      code: "vault_root_unreachable",
      details: { path: "content://usb/tree/A1B2" },
    });
  });

  it("keeps other mount failures as their SAF code", () => {
    native.current = {
      mountSafRoot: () => {
        throw new Error("saf_not_ready: chosen folder cannot store vaults");
      },
    };
    expect(() => mountSafRoot("content://tree")).toThrow(
      expect.objectContaining({ code: "saf_not_ready" }),
    );
  });
});

describe("mountSafExport", () => {
  beforeEach(() => {
    native.current = null;
  });

  it("keeps an unplugged export drive as its own SAF code, not the data folder's", () => {
    native.current = {
      mountSafExport: () => {
        throw new Error("saf_unreachable: export folder is not reachable");
      },
    };
    expect(() => mountSafExport("content://usb/tree/A1B2")).toThrow(
      expect.objectContaining({
        code: "saf_unreachable",
        details: { path: "content://usb/tree/A1B2" },
      }),
    );
  });
});
