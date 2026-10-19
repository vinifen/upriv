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

describe("data folder export rpc", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("sends the folder and reads the written zip", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        result: { path: "/upriv-saf-export/upriv-2026-10-19-031500.zip", size: 2048 },
      }),
    );
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(rpcDataFolderExport("/upriv-saf-export")).resolves.toEqual({
      path: "/upriv-saf-export/upriv-2026-10-19-031500.zip",
      size: 2048,
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "data_folder_export",
      JSON.stringify({ destDir: "/upriv-saf-export" }),
    );
  });

  it("refuses an answer without the written zip", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { size: 1 } }));
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(rpcDataFolderExport("/upriv-saf-export")).rejects.toBeInstanceOf(RpcError);
  });

  it("reads progress only while an export runs", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { running: true, bytesDone: 5, bytesTotal: 50 } }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { running: false, bytesDone: 0, bytesTotal: 0 } }),
      );
    const { rpcDataFolderExportStatus } = await import("../rpc");
    await expect(rpcDataFolderExportStatus()).resolves.toEqual({ bytesDone: 5, bytesTotal: 50 });
    await expect(rpcDataFolderExportStatus()).resolves.toBeNull();
  });

  it("reports whether a stop reached a running export", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { cancelled: true } }));
    const { rpcDataFolderExportCancel } = await import("../rpc");
    await expect(rpcDataFolderExportCancel()).resolves.toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("data_folder_export_cancel", "{}");
  });
});
