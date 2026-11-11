import { describe, expect, it } from "vitest";
import {
  BACKUP_FOLDER_STATUSES,
  appBackupFolders,
  backupFellBackToastKey,
  backupFolderIssue,
  backupFolderLeftBehind,
  backupFolderStatusI18nKey,
  backupFolderSystem,
  closeAllFellBackToast,
  normalizeAppBackupFolders,
  normalizeVaultBackupFolders,
  parseBackupFolderStatus,
  vaultBackupFolders,
} from "../folders";

describe("backupFolderSystem", () => {
  it("gives each desktop system its row and a phone none", () => {
    expect(backupFolderSystem("linux")).toBe("linux");
    expect(backupFolderSystem("windows")).toBe("windows");
    expect(backupFolderSystem("macos")).toBe("macos");
    expect(backupFolderSystem("android")).toBeNull();
    expect(backupFolderSystem("ios")).toBeNull();
  });
});

describe("folder tables", () => {
  it("start in the data folder for the app and on inherit for a vault", () => {
    expect(appBackupFolders().linux).toEqual({ place: "data_folder", path: "" });
    expect(vaultBackupFolders().windows).toEqual({ place: "inherit", path: "" });
  });

  it("fill a missing table with every row", () => {
    expect(normalizeAppBackupFolders(undefined)).toEqual(appBackupFolders());
    expect(normalizeVaultBackupFolders(undefined)).toEqual(vaultBackupFolders());
  });

  it("keep the path of a row that points elsewhere", () => {
    const app = normalizeAppBackupFolders({ linux: { place: "data_folder", path: "/mnt/usb" } });
    expect(app.linux).toEqual({ place: "data_folder", path: "/mnt/usb" });
    const vault = normalizeVaultBackupFolders({ linux: { place: "inherit", path: "/mnt/usb" } });
    expect(vault.linux).toEqual({ place: "inherit", path: "/mnt/usb" });
  });

  it("read an unknown place as the row's default", () => {
    expect(normalizeAppBackupFolders({ macos: { place: "inherit" } }).macos.place).toBe(
      "data_folder",
    );
    expect(normalizeVaultBackupFolders({ macos: { place: "elsewhere" } }).macos.place).toBe(
      "inherit",
    );
  });
});

describe("backupFolderIssue", () => {
  it("has nothing to say about a row that does not use its path", () => {
    expect(backupFolderIssue("data_folder", "relative")).toBeNull();
    expect(backupFolderIssue("inherit", "relative")).toBeNull();
  });

  it("waits for the path of a chosen folder", () => {
    expect(backupFolderIssue("custom", "   ")).toBe("empty");
  });

  it("refuses a relative path and one inside the data folder", () => {
    expect(backupFolderIssue("custom", "backups")).toBe("not_absolute");
    expect(backupFolderIssue("custom", "/data/.upriv/backups", "/data")).toBe("reserved");
    expect(backupFolderIssue("custom", "/mnt/usb", "/data")).toBeNull();
  });
});

describe("backupFolderLeftBehind", () => {
  const custom = (path: string) => ({ place: "custom" as const, path });
  const dataFolder = { place: "data_folder" as const, path: "" };
  const inherit = { place: "inherit" as const, path: "" };

  it("is true when a vault leaves its chosen folder", () => {
    expect(
      backupFolderLeftBehind(
        { app: dataFolder, vault: custom("/mnt/a") },
        { app: dataFolder, vault: custom("/mnt/b") },
      ),
    ).toBe(true);
    expect(
      backupFolderLeftBehind(
        { app: dataFolder, vault: custom("/mnt/a") },
        { app: dataFolder, vault: { place: "data_folder", path: "/mnt/a" } },
      ),
    ).toBe(true);
  });

  it("is true when a vault that follows the app default sees it change", () => {
    expect(
      backupFolderLeftBehind(
        { app: custom("/mnt/a"), vault: inherit },
        { app: dataFolder, vault: inherit },
      ),
    ).toBe(true);
  });

  it("is false when the folder stays or there was none", () => {
    expect(
      backupFolderLeftBehind(
        { app: custom("/mnt/a"), vault: inherit },
        { app: dataFolder, vault: custom(" /mnt/a ") },
      ),
    ).toBe(false);
    expect(
      backupFolderLeftBehind(
        { app: dataFolder, vault: inherit },
        { app: custom("/mnt/a"), vault: inherit },
      ),
    ).toBe(false);
  });

  it("ignores an app default the vault does not follow", () => {
    expect(
      backupFolderLeftBehind(
        { app: custom("/mnt/a"), vault: { place: "data_folder", path: "" } },
        { app: dataFolder, vault: { place: "data_folder", path: "" } },
      ),
    ).toBe(false);
  });

  it("has no folder to leave on a phone", () => {
    expect(backupFolderLeftBehind({ app: null, vault: null }, { app: null, vault: null })).toBe(
      false,
    );
  });
});

describe("backup folder statuses", () => {
  it("read a known status and refuse anything else", () => {
    expect(parseBackupFolderStatus("no_room")).toBe("no_room");
    expect(parseBackupFolderStatus("nope")).toBeNull();
    expect(parseBackupFolderStatus(undefined)).toBeNull();
  });

  it("have a status line for each", () => {
    for (const status of BACKUP_FOLDER_STATUSES) {
      expect(backupFolderStatusI18nKey(status)).toBe(`modal.backup.folder.status.${status}`);
    }
  });

  it("have a fallback toast for each, and `ok` never claims a cause", () => {
    expect(backupFellBackToastKey("no_room")).toBe("toast.backup_fell_back.no_room");
    expect(backupFellBackToastKey("ok")).toBe("toast.backup_fell_back.other");
  });
});

describe("closeAllFellBackToast", () => {
  it("says nothing when every backup went where it should", () => {
    expect(closeAllFellBackToast([])).toBeNull();
  });

  it("names the one vault and why", () => {
    expect(closeAllFellBackToast([{ name: "Notes", status: "missing" }])).toEqual({
      key: "toast.backup_fell_back.missing",
      params: { name: "Notes" },
    });
  });

  it("counts several in one toast", () => {
    expect(
      closeAllFellBackToast([
        { name: "Notes", status: "missing" },
        { name: "Photos", status: "no_room" },
      ]),
    ).toEqual({ key: "toast.backup_fell_back_many", params: { count: "2" } });
  });
});
