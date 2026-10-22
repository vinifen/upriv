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

  it("sends the folder, the zip name, and the job, and reads the written zip", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        result: { path: "/upriv-saf-export/phone-copy.zip", size: 2048 },
      }),
    );
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(rpcDataFolderExport("/upriv-saf-export", "phone-copy", "job-1")).resolves.toEqual({
      path: "/upriv-saf-export/phone-copy.zip",
      size: 2048,
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "data_folder_export",
      JSON.stringify({ destDir: "/upriv-saf-export", name: "phone-copy", job: "job-1" }),
    );
  });

  it("refuses an answer without the written zip", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { size: 1 } }));
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(
      rpcDataFolderExport("/upriv-saf-export", "phone-copy", "job-1"),
    ).rejects.toBeInstanceOf(RpcError);
  });
});

describe("job rpc", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("reads progress only while the job runs", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { running: true, bytesDone: 5, bytesTotal: 50 } }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { running: false, bytesDone: 0, bytesTotal: 0 } }),
      );
    const { rpcJobStatus } = await import("../rpc");
    await expect(rpcJobStatus("job-1")).resolves.toEqual({ bytesDone: 5, bytesTotal: 50 });
    await expect(rpcJobStatus("job-1")).resolves.toBeNull();
    expect(native.invoke).toHaveBeenCalledWith("job_status", JSON.stringify({ job: "job-1" }));
  });

  it("stops the job it names, saying who asked", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { running: true } }));
    const { rpcJobCancel } = await import("../rpc");
    await expect(rpcJobCancel("job-1", "user")).resolves.toBeUndefined();
    expect(native.invoke).toHaveBeenCalledWith(
      "job_cancel",
      JSON.stringify({ job: "job-1", by: "user" }),
    );
  });

  it("sends the folder and the job with a vault export, and the job with a save", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { path: "/upriv-saf-export/Notes.zip", size: 10 } }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ok: true,
          result: {
            backup: {
              stamp: "20260101000000",
              fileName: "20260101000000-notes.zip",
              createdAt: "2026-01-01T00:00:00Z",
              sizeBytes: 10,
              saved: true,
            },
          },
        }),
      );
    const { rpcBackupSave, rpcVaultExportToFolder } = await import("../rpc");
    await expect(
      rpcVaultExportToFolder("notes", { format: "store_zip" }, "/upriv-saf-export", "job-2"),
    ).resolves.toEqual({ path: "/upriv-saf-export/Notes.zip", size: 10 });
    await rpcBackupSave("notes", "job-3");
    expect(JSON.parse(native.invoke.mock.calls[0][1] as string)).toMatchObject({
      id: "notes",
      destDir: "/upriv-saf-export",
      job: "job-2",
    });
    expect(native.invoke).toHaveBeenNthCalledWith(
      2,
      "backup_save",
      JSON.stringify({ id: "notes", job: "job-3" }),
    );
  });
});
