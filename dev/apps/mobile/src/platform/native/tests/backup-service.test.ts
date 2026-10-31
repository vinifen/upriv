import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_BUDGET_MS } from "@upriv/shared";

const WRITTEN = { path: "/upriv-saf-export/upriv-backups-notes.zip", size: 4096 };
const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const MOUNTED = "/upriv-saf-export";

const mocks = vi.hoisted(() => ({
  rpcBackupExport: vi.fn(),
  withExportFolder: vi.fn(),
}));

vi.mock("@/lib/rpc", () => ({
  rpcBackupDelete: vi.fn(),
  rpcBackupExport: mocks.rpcBackupExport,
  rpcBackupList: vi.fn(),
  rpcBackupPromote: vi.fn(),
  rpcBackupSave: vi.fn(),
}));

vi.mock("../safExportMount", () => ({
  nativeSafExportMount: { withExportFolder: mocks.withExportFolder },
}));

import { nativeBackupService } from "../backupService";

describe("nativeBackupService.exportTo", () => {
  beforeEach(() => {
    mocks.rpcBackupExport.mockReset().mockResolvedValue(WRITTEN);
    mocks.withExportFolder
      .mockReset()
      .mockImplementation((_dir, _job, _budget, write: (dir: string) => Promise<unknown>) =>
        write(MOUNTED),
      );
  });

  it("writes through the export mount, so nothing is staged in app storage", async () => {
    await expect(
      nativeBackupService.exportTo("notes", ["a.zip", "saves/b.zip"], PICKED, "job-1"),
    ).resolves.toEqual(WRITTEN);

    expect(mocks.withExportFolder).toHaveBeenCalledWith(
      PICKED,
      "job-1",
      LOADING_BUDGET_MS.backupExport,
      expect.any(Function),
    );
    expect(mocks.rpcBackupExport).toHaveBeenCalledWith(
      "notes",
      ["a.zip", "saves/b.zip"],
      MOUNTED,
      "job-1",
    );
  });
});
