import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultExportRequest, VaultRow } from "@upriv/shared";

const pickSaveFile = vi.fn<(options: unknown) => Promise<string | null>>();
vi.mock("@/lib/rpc", () => ({ rpcPickSaveFile: (options: unknown) => pickSaveFile(options) }));

import { exportVaultPackage, type ExportVaultPackageFns } from "../exportVaultPackage";

const vault: VaultRow = {
  id: "notes",
  displayName: "Notes",
  session: null,
  storageMode: "encrypted_dir",
};
const request: VaultExportRequest = { format: "store_zip" };
const JOB = "job-export";

function fns(): ExportVaultPackageFns & { exportToPath: ReturnType<typeof vi.fn> } {
  return {
    exportToPath: vi.fn(async (_vault, _request, destPath) => ({ path: destPath, size: 1 })),
  };
}

describe("exportVaultPackage", () => {
  beforeEach(() => {
    pickSaveFile.mockReset();
  });

  it("writes the chosen file in core as its job", async () => {
    pickSaveFile.mockResolvedValue("/media/usb/Notes.zip");
    const write = fns();
    await expect(exportVaultPackage(vault, write, request, JOB)).resolves.toBe("written");
    expect(pickSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Notes.zip" }),
    );
    expect(write.exportToPath).toHaveBeenCalledWith(vault, request, "/media/usb/Notes.zip", JOB);
  });

  it("starts nothing when the save dialog is dismissed", async () => {
    pickSaveFile.mockResolvedValue(null);
    const write = fns();
    await expect(exportVaultPackage(vault, write, request, JOB)).resolves.toBe("cancelled");
    expect(write.exportToPath).not.toHaveBeenCalled();
  });

  it("starts nothing once the budget ran out while the dialog was open", async () => {
    const abort = new AbortController();
    pickSaveFile.mockImplementation(async () => {
      abort.abort();
      return "/media/usb/Notes.zip";
    });
    const write = fns();
    await expect(exportVaultPackage(vault, write, request, JOB, abort.signal)).resolves.toBe(
      "cancelled",
    );
    expect(write.exportToPath).not.toHaveBeenCalled();
  });
});
