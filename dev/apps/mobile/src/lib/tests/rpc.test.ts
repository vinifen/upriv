import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError, createDefaultAppSettings } from "@upriv/shared";

const native = {
  invoke: vi.fn<(method: string, paramsJson: string) => Promise<string>>(),
};

vi.mock("upriv-core", () => ({
  getUprivCoreNative: () => native,
}));

describe("mobile rpc parser guards", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("parses app_settings_get envelope", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        result: { settings: createDefaultAppSettings(), rootPath: "/tmp/root", onDisk: true },
      }),
    );
    const { rpcAppSettingsGet } = await import("../rpc");
    const result = await rpcAppSettingsGet();
    expect(result.rootPath).toBe("/tmp/root");
    expect(result.onDisk).toBe(true);
  });

  it("throws RpcError for malformed envelopes", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: "bad-shape" }));
    const { rpcAppSettingsGet } = await import("../rpc");
    await expect(rpcAppSettingsGet()).rejects.toBeInstanceOf(RpcError);
  });

  it("unwraps rpc wire errors from invoke envelope", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: false,
        error: { code: "vault_root_not_found", message: "missing" },
      }),
    );
    const { nativeInvokeRaw } = await import("../rpc");
    await expect(nativeInvokeRaw("vault_root_resolve")).rejects.toMatchObject({
      code: "vault_root_not_found",
      message: "missing",
    });
  });
});
