import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseBackupFolderCheck, parseBackupListing, parseBackupSaved } from "../parse";

const WIRE_ENTRY = {
  stamp: "20260528120000",
  fileName: "20260528120000-notes.zip",
  createdAt: "2026-05-28T12:00:00.000Z",
  sizeBytes: 10,
  saved: true,
  location: "chosen",
  path: "/mnt/usb/upriv-notes-backups/saves/20260528120000-notes.zip",
};

describe("parseBackupListing", () => {
  it("keeps where each backup is and the state of the chosen folder", () => {
    const listing = parseBackupListing(
      { backups: [WIRE_ENTRY], chosen: { path: "/mnt/usb/upriv-notes-backups", status: "ok" } },
      "notes",
    );
    expect(listing.backups).toEqual([WIRE_ENTRY]);
    expect(listing.chosen).toEqual({ path: "/mnt/usb/upriv-notes-backups", status: "ok" });
  });

  it("reads an entry with no location as one in the data folder", () => {
    const { backups } = parseBackupListing({ backups: [{ stamp: "1" }], chosen: null }, "notes");
    expect(backups[0].location).toBe("data_folder");
    expect(backups[0].path).toBeUndefined();
    expect(backups[0].fileName).toBe("1-notes.zip");
    expect(backups[0].saved).toBe(false);
  });

  it("has no chosen folder when none is reported", () => {
    expect(parseBackupListing({ backups: [] }, "notes").chosen).toBeNull();
    expect(
      parseBackupListing({ backups: [], chosen: { status: "ok" } }, "notes").chosen,
    ).toBeNull();
  });

  it("reads an unknown folder status as other", () => {
    const { chosen } = parseBackupListing(
      { backups: [], chosen: { path: "/mnt/usb", status: "melted" } },
      "notes",
    );
    expect(chosen?.status).toBe("other");
  });

  it("refuses an answer without a list", () => {
    expect(() => parseBackupListing({ chosen: null }, "notes")).toThrow(RpcError);
    expect(() => parseBackupListing(null, "notes")).toThrow(RpcError);
  });
});

describe("parseBackupSaved", () => {
  it("reports why the backup went to the data folder", () => {
    const saved = parseBackupSaved(
      { backup: { ...WIRE_ENTRY, location: "data_folder" }, fallback: "no_room" },
      "notes",
    );
    expect(saved.backup.location).toBe("data_folder");
    expect(saved.fallback).toBe("no_room");
  });

  it("has no fallback for a backup written where it should be", () => {
    expect(parseBackupSaved({ backup: WIRE_ENTRY, fallback: null }, "notes").fallback).toBeNull();
  });

  it("refuses an answer without the backup", () => {
    expect(() => parseBackupSaved({ fallback: null }, "notes")).toThrow(RpcError);
  });
});

describe("parseBackupFolderCheck", () => {
  it("reads the status, and an unknown one as other", () => {
    expect(parseBackupFolderCheck({ status: "missing" })).toBe("missing");
    expect(parseBackupFolderCheck({ status: "melted" })).toBe("other");
  });

  it("refuses an answer that is no object", () => {
    expect(() => parseBackupFolderCheck("ok")).toThrow(RpcError);
  });
});
