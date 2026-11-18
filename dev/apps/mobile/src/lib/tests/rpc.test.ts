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

describe("folder lists on a phone", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("sends only what changed in the lists, and reads what the save left", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        result: { wrote: true, unchangedVaults: ["notes"], keptFolders: ["/sd/upriv-unlocked"] },
      }),
    );
    const settings = createDefaultAppSettings();
    const lists = {
      unlockedFolders: { groups: {} },
      backups: { groups: { ["a".repeat(32)]: { selected: "data_folder" as const } } },
    };
    const { rpcAppSettingsSave } = await import("../rpc");

    await expect(rpcAppSettingsSave(settings, lists)).resolves.toEqual({
      wrote: true,
      unchangedVaults: ["notes"],
      keptFolders: ["/sd/upriv-unlocked"],
    });
    const [method, params] = native.invoke.mock.calls[0];
    expect(method).toBe("app_settings_save");
    expect(JSON.parse(params).lists).toEqual(lists);
  });

  it("sends the outside backups choice, Delete now, and the job with a delete", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({ ok: true, result: { outside: "kept", folders: ["/sd/backups"] } }),
    );
    const { rpcVaultDelete } = await import("../rpc");

    await expect(
      rpcVaultDelete("notes", { outsideBackups: false, now: true, job: "job-1" }),
    ).resolves.toEqual({ outside: "kept", folder: "/sd/backups" });
    expect(native.invoke).toHaveBeenCalledWith(
      "vault_delete",
      JSON.stringify({ id: "notes", outsideBackups: false, now: true, job: "job-1" }),
    );
  });

  it("tells a running delete to finish now, and reads whether one ran", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { running: true } }));
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { running: false } }));
    const { rpcVaultDeleteHurry } = await import("../rpc");

    await expect(rpcVaultDeleteHurry("notes")).resolves.toBe(true);
    await expect(rpcVaultDeleteHurry("notes")).resolves.toBe(false);
    expect(native.invoke).toHaveBeenCalledWith(
      "vault_delete_hurry",
      JSON.stringify({ id: "notes" }),
    );
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
        result: { path: "/upriv-saf-tree/picked/phone-copy.zip", size: 2048 },
      }),
    );
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(
      rpcDataFolderExport("/upriv-saf-tree/picked", "phone-copy", false, "job-1"),
    ).resolves.toEqual({
      path: "/upriv-saf-tree/picked/phone-copy.zip",
      size: 2048,
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "data_folder_export",
      JSON.stringify({
        destDir: "/upriv-saf-tree/picked",
        name: "phone-copy",
        includeBackups: false,
        job: "job-1",
      }),
    );
  });

  it("refuses an answer without the written zip", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { size: 1 } }));
    const { rpcDataFolderExport } = await import("../rpc");
    await expect(
      rpcDataFolderExport("/upriv-saf-tree/picked", "phone-copy", true, "job-1"),
    ).rejects.toBeInstanceOf(RpcError);
  });
});

describe("job rpc", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("reads progress and its step only while the job runs", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({
          ok: true,
          result: {
            running: true,
            bytesDone: 5,
            bytesTotal: 50,
            stoppable: false,
            step: "rewriting_files",
          },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { running: false, bytesDone: 0, bytesTotal: 0 } }),
      );
    const { rpcJobStatus } = await import("../rpc");
    await expect(rpcJobStatus("job-1")).resolves.toEqual({
      bytesDone: 5,
      bytesTotal: 50,
      stoppable: false,
      step: "rewriting_files",
    });
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
        JSON.stringify({
          ok: true,
          result: { path: "/upriv-saf-tree/picked/Notes.zip", size: 10, unreadable: [] },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ok: true,
          result: {
            backup: {
              key: "data/saves/20260101000000-notes.zip",
              stamp: "20260101000000",
              fileName: "20260101000000-notes.zip",
              createdAt: "2026-01-01T00:00:00Z",
              sizeBytes: 10,
              saved: true,
            },
            switches: [],
          },
        }),
      );
    const { rpcBackupSave, rpcVaultExportToFolder } = await import("../rpc");
    await expect(
      rpcVaultExportToFolder("notes", { format: "store_zip" }, "/upriv-saf-tree/picked", "job-2"),
    ).resolves.toEqual({ path: "/upriv-saf-tree/picked/Notes.zip", size: 10, unreadable: [] });
    await rpcBackupSave("notes", "job-3");
    expect(JSON.parse(native.invoke.mock.calls[0][1] as string)).toMatchObject({
      id: "notes",
      destDir: "/upriv-saf-tree/picked",
      job: "job-2",
    });
    expect(native.invoke).toHaveBeenNthCalledWith(
      2,
      "backup_save",
      JSON.stringify({ id: "notes", job: "job-3" }),
    );
  });

  it("sends a backup export's folder and job with its backups", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({
        ok: true,
        result: { path: "/upriv-saf-tree/picked/upriv-backups-notes.zip", size: 10 },
      }),
    );
    const { rpcBackupExport } = await import("../rpc");
    await expect(
      rpcBackupExport(
        "notes",
        ["data/a.zip", "data/saves/b.zip"],
        "/upriv-saf-tree/picked",
        "job-4",
      ),
    ).resolves.toEqual({ path: "/upriv-saf-tree/picked/upriv-backups-notes.zip", size: 10 });
    expect(native.invoke).toHaveBeenCalledWith(
      "backup_export",
      JSON.stringify({
        id: "notes",
        keys: ["data/a.zip", "data/saves/b.zip"],
        destDir: "/upriv-saf-tree/picked",
        job: "job-4",
      }),
    );
  });

  it("refuses a backup export answer without a path", async () => {
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { size: 10 } }));
    const { rpcBackupExport } = await import("../rpc");
    await expect(
      rpcBackupExport("notes", ["a.zip"], "/upriv-saf-tree/picked", "job-5"),
    ).rejects.toThrow("backup_export: expected path+size");
  });
});

describe("storage rpc", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("reads an open's storage reset, and none when the open sends none", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({ ok: true, result: { switches: [], storageReset: "unsaved" } }),
      )
      .mockResolvedValueOnce(JSON.stringify({ ok: true, result: { switches: [] } }));
    const { rpcVaultOpen } = await import("../rpc");

    await expect(rpcVaultOpen("notes", "pw", "job-1")).resolves.toEqual({
      switches: [],
      storageReset: "unsaved",
    });
    await expect(rpcVaultOpen("notes", "pw", "job-2")).resolves.toEqual({
      switches: [],
      storageReset: null,
    });
  });

  it("asks where an unlock in a mode puts the files, and refuses an answer without an outcome", async () => {
    native.invoke
      .mockResolvedValueOnce(
        JSON.stringify({
          ok: true,
          result: {
            outcome: "folder",
            path: "/upriv-saf-tree/k/upriv-unlocked/Notes",
            switches: [],
          },
        }),
      )
      .mockResolvedValueOnce(JSON.stringify({ ok: true, result: {} }));
    const { rpcVaultUnlockedDestination } = await import("../rpc");

    await expect(rpcVaultUnlockedDestination("notes", "upriv_plain")).resolves.toMatchObject({
      outcome: "folder",
      path: "/upriv-saf-tree/k/upriv-unlocked/Notes",
    });
    const [method, params] = native.invoke.mock.calls[0];
    expect(method).toBe("vault_unlocked_destination");
    expect(JSON.parse(params)).toEqual({ id: "notes", mode: "upriv_plain" });
    await expect(rpcVaultUnlockedDestination("notes", "upriv_plain")).rejects.toBeInstanceOf(
      RpcError,
    );
  });

  it("sends the password, both storage fields, and the job with a Storage change", async () => {
    const storage = { mode: "upriv_plain" as const, plain_files: "whole" as const };
    native.invoke.mockResolvedValueOnce(JSON.stringify({ ok: true, result: { storage } }));
    const { rpcVaultChangeStorage } = await import("../rpc");

    await expect(rpcVaultChangeStorage("notes", "pw", storage, "job-3")).resolves.toEqual({
      storage,
    });
    const [method, params] = native.invoke.mock.calls[0];
    expect(method).toBe("vault_change_storage");
    expect(JSON.parse(params)).toEqual({
      id: "notes",
      password: "pw",
      mode: "upriv_plain",
      plainFiles: "whole",
      job: "job-3",
    });
  });

  it("refuses a Storage change answer without a known value", async () => {
    native.invoke.mockResolvedValueOnce(
      JSON.stringify({ ok: true, result: { storage: { mode: "sealed", plain_files: "chosen" } } }),
    );
    const { rpcVaultChangeStorage } = await import("../rpc");
    await expect(
      rpcVaultChangeStorage(
        "notes",
        "pw",
        { mode: "encrypted_dir", plain_files: "chosen" },
        "job-4",
      ),
    ).rejects.toThrow("vault_change_storage: expected the stored value");
  });
});
