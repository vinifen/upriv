import { describe, expect, it } from "vitest";
import { RpcError } from "../../core-rpc/errors";
import { parseBackupEntry, parseBackupListing, parseBackupSaved } from "../parse";

const DESK = "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d";

const WIRE_ENTRY = {
  key: "f1/saves/20260528120000-notes Trip.zip",
  stamp: "20260528120000",
  fileName: "20260528120000-notes Trip.zip",
  name: "Trip",
  createdAt: "2026-05-28T12:00:00.000Z",
  sizeBytes: 10,
  saved: true,
  path: "/mnt/usb/upriv-notes-backups/saves/20260528120000-notes Trip.zip",
};

describe("parseBackupListing", () => {
  it("keeps each folder with its state and its zips", () => {
    const listing = parseBackupListing({
      sections: [
        {
          folder: "f1",
          kind: "in_use",
          path: "/mnt/usb/upriv-notes-backups",
          device: { id: DESK, system: "linux" },
          status: "ok",
          entries: [WIRE_ENTRY],
        },
        {
          folder: "data",
          kind: "data_folder",
          path: "/d",
          device: null,
          status: "ok",
          entries: [],
        },
      ],
    });
    expect(listing.sections[0]).toEqual({
      folder: "f1",
      kind: "in_use",
      path: "/mnt/usb/upriv-notes-backups",
      device: { id: DESK, system: "linux" },
      status: "ok",
      entries: [WIRE_ENTRY],
    });
    // The data folder names no device.
    expect(listing.sections[1].device).toBeNull();
  });

  it("reads an unknown state as other and an unknown kind as another folder", () => {
    const { sections } = parseBackupListing({
      sections: [{ folder: "f2", kind: "sideways", status: "melted", entries: [] }],
    });
    expect(sections[0].status).toBe("other");
    expect(sections[0].kind).toBe("other");
  });

  it("refuses an answer without sections, or an entry without a key", () => {
    expect(() => parseBackupListing({})).toThrow(RpcError);
    expect(() => parseBackupListing(null)).toThrow(RpcError);
    expect(() => parseBackupEntry({ stamp: "1" })).toThrow(RpcError);
  });
});

describe("parseBackupSaved", () => {
  it("keeps the switches the folder needed", () => {
    const saved = parseBackupSaved({
      backup: WIRE_ENTRY,
      switches: [
        {
          list: "backup",
          level: "vault",
          vault: "notes",
          from: { kind: "row", number: 1, name: "USB" },
          to: { kind: "fixed", choice: "data_folder" },
          reason: "missing",
          saved: true,
        },
      ],
    });
    expect(saved.backup.key).toBe(WIRE_ENTRY.key);
    expect(saved.switches).toHaveLength(1);
    expect(saved.switches[0].to).toEqual({ kind: "fixed", choice: "data_folder" });
  });
});
