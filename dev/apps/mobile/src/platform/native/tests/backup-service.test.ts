import { beforeEach, describe, expect, it, vi } from "vitest";

const WRITTEN = { path: "/upriv-saf-tree/k1/upriv-backups-notes.zip", size: 4096 };
const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const MOUNTED = "/upriv-saf-tree/k1";

const mocks = vi.hoisted(() => ({
  rpcBackupExport: vi.fn(),
  withExportFolder: vi.fn(),
}));

vi.mock("@/lib/rpc", () => ({
  rpcBackupDelete: vi.fn(),
  rpcBackupExport: mocks.rpcBackupExport,
  rpcBackupFolderForget: vi.fn(),
  rpcBackupList: vi.fn(),
  rpcBackupPromote: vi.fn(),
  rpcBackupRename: vi.fn(),
  rpcBackupSave: vi.fn(),
}));

vi.mock("../exportTrees", () => ({
  nativeExportTrees: { withExportFolder: mocks.withExportFolder },
}));

import { nativeBackupService } from "../backupService";

describe("nativeBackupService.exportTo", () => {
  beforeEach(() => {
    mocks.rpcBackupExport.mockReset().mockResolvedValue(WRITTEN);
    mocks.withExportFolder
      .mockReset()
      .mockImplementation((_dir, _job, write: (dir: string) => Promise<unknown>) => write(MOUNTED));
  });

  it("writes into the picked tree's root, so nothing is staged in app storage", async () => {
    await expect(
      nativeBackupService.exportTo("notes", ["data/a.zip", "data/saves/b.zip"], PICKED, "job-1"),
    ).resolves.toEqual(WRITTEN);

    expect(mocks.withExportFolder).toHaveBeenCalledWith(PICKED, "job-1", expect.any(Function));
    expect(mocks.rpcBackupExport).toHaveBeenCalledWith(
      "notes",
      ["data/a.zip", "data/saves/b.zip"],
      MOUNTED,
      "job-1",
    );
  });
});
