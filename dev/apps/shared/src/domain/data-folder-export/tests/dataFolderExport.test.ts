import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { errorDisplayI18nKey } from "../../errors";
import { resolveVaultListStatus, type VaultRow } from "../../vault/types";
import { dataFolderCanExport, dataFolderExportPending } from "../canExport";
import { DATA_FOLDER_EXPORT_ERROR_CODES, isDataFolderExportCancelled } from "../errors";
import { dataFolderExportPercent, dataFolderZipName, parseDataFolderExportStatus } from "../types";

function row(id: string, session: VaultRow["session"] = null): VaultRow {
  return { id, displayName: id, session, storageMode: "encrypted_dir" };
}

describe("parseDataFolderExportStatus", () => {
  it("reads a running export", () => {
    expect(parseDataFolderExportStatus({ running: true, bytesDone: 5, bytesTotal: 10 })).toEqual({
      bytesDone: 5,
      bytesTotal: 10,
    });
  });

  it("is null when nothing runs or the answer is not an object", () => {
    expect(parseDataFolderExportStatus({ running: false, bytesDone: 0, bytesTotal: 0 })).toBeNull();
    expect(parseDataFolderExportStatus(null)).toBeNull();
    expect(parseDataFolderExportStatus("running")).toBeNull();
  });
});

describe("dataFolderExportPercent", () => {
  it("is null until the size is measured", () => {
    expect(dataFolderExportPercent(null)).toBeNull();
    expect(dataFolderExportPercent({ bytesDone: 0, bytesTotal: 0 })).toBeNull();
  });

  it("rounds down and stays within 0 to 100", () => {
    expect(dataFolderExportPercent({ bytesDone: 1, bytesTotal: 3 })).toBe(33);
    expect(dataFolderExportPercent({ bytesDone: 3, bytesTotal: 3 })).toBe(100);
    expect(dataFolderExportPercent({ bytesDone: 9, bytesTotal: 3 })).toBe(100);
  });
});

describe("dataFolderZipName", () => {
  it("takes the last part of a Linux or Windows path", () => {
    expect(dataFolderZipName("/media/usb/upriv-2026-10-19-101500.zip")).toBe(
      "upriv-2026-10-19-101500.zip",
    );
    expect(dataFolderZipName("E:\\Backups\\upriv-2026-10-19-101500.zip")).toBe(
      "upriv-2026-10-19-101500.zip",
    );
  });
});

describe("dataFolderCanExport", () => {
  it("allows closed vaults, vaults in recovery, and an empty data folder", () => {
    expect(dataFolderCanExport([row("a"), row("b", "recovery")])).toBe(true);
    expect(dataFolderCanExport([])).toBe(true);
  });

  it("refuses an open or closing vault", () => {
    expect(dataFolderCanExport([row("a"), row("b", "open")])).toBe(false);
    expect(dataFolderCanExport([row("a", "closing")])).toBe(false);
  });

  it("refuses while any vault work runs, listed or not", () => {
    const vaults = [row("a")];
    expect(dataFolderCanExport(vaults, { exportingVaultIds: ["a"] })).toBe(false);
    expect(dataFolderCanExport(vaults, { backupJobVaultIds: ["a"] })).toBe(false);
    expect(dataFolderCanExport(vaults, { passwordChangeVaultIds: ["a"] })).toBe(false);
    expect(dataFolderCanExport(vaults, { creatingVaultIds: ["new"] })).toBe(false);
    expect(dataFolderCanExport(vaults, { queuedVaultIds: ["a"] })).toBe(false);
    expect(dataFolderCanExport(vaults, { openingVaultIds: ["a"] })).toBe(false);
  });

  it("refuses a second export", () => {
    expect(dataFolderCanExport([row("a")], { dataFolderExporting: true })).toBe(false);
  });
});

describe("dataFolderExportPending", () => {
  const name = "upriv-2026-10-19-101500";

  it("needs a folder first, then an absolute one", () => {
    expect(dataFolderExportPending(null, name)).toBe("folder");
    expect(dataFolderExportPending("  ", name)).toBe("folder");
    expect(dataFolderExportPending("Downloads", name)).toBe("folder_not_absolute");
  });

  it("takes a typed or picked folder, a phone tree, and a name every system holds", () => {
    expect(dataFolderExportPending(" /media/usb ", name)).toBeNull();
    expect(dataFolderExportPending("E:\\Copies", name)).toBeNull();
    expect(
      dataFolderExportPending(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload",
        name,
      ),
    ).toBeNull();
    expect(dataFolderExportPending("/media/usb", "trip/copy")).toBe("name");
    expect(dataFolderExportPending("/media/usb", "")).toBe("name");
  });
});

describe("rows during a data-folder export", () => {
  it("show every vault as exporting", () => {
    const pipeline = { dataFolderExporting: true };
    expect(resolveVaultListStatus(row("a"), pipeline)).toBe("exporting");
    expect(resolveVaultListStatus(row("b", "recovery"), pipeline)).toBe("exporting");
  });
});

describe("data-folder export errors", () => {
  it("map to their own messages", () => {
    expect(
      errorDisplayI18nKey(new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY, "busy")),
    ).toBe("error.data_folder_export_busy");
    expect(
      errorDisplayI18nKey(new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.SPACE_SHORT, "space")),
    ).toBe("error.data_folder_export_space_short");
    expect(
      errorDisplayI18nKey(new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.NAME_TAKEN, "taken")),
    ).toBe("error.data_folder_export_name_taken");
  });

  it("recognize a stop by the user", () => {
    expect(
      isDataFolderExportCancelled(new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.CANCELLED, "x")),
    ).toBe(true);
    expect(isDataFolderExportCancelled(new RpcError("io_error", "x"))).toBe(false);
    expect(isDataFolderExportCancelled(new Error("x"))).toBe(false);
  });
});
