import { describe, expect, it } from "vitest";
import { backupListSections, backupSectionSelection, toggleBackupSection } from "../sections";
import type { VaultBackupEntry } from "../types";

function entry(
  stamp: string,
  patch: Partial<VaultBackupEntry> = {},
  dir = "/data/.upriv/vaults/notes/backups",
): VaultBackupEntry {
  const fileName = `${stamp}-notes.zip`;
  const folder = patch.saved ? `${dir}/saves` : dir;
  return { stamp, fileName, createdAt: "", path: `${folder}/${fileName}`, ...patch };
}

describe("backupListSections", () => {
  it("lists the data folder, then the chosen folder, each with its Saves first", () => {
    const sections = backupListSections(
      [
        entry("1", { location: "chosen" }, "/mnt/usb/upriv-notes-backups"),
        entry("2"),
        entry("3", { saved: true, location: "chosen" }, "/mnt/usb/upriv-notes-backups"),
        entry("4", { saved: true }),
      ],
      "notes",
    );
    expect(sections.map((section) => section.id)).toEqual(["data_folder", "chosen"]);
    expect(sections[1].groups.map((group) => group.saved)).toEqual([true, false]);
    expect(sections[1].keys).toEqual(["chosen/saves/3-notes.zip", "chosen/1-notes.zip"]);
    expect(sections[1].folder).toBe("/mnt/usb/upriv-notes-backups");
  });

  it("leaves out a folder or a tier with nothing in it", () => {
    const sections = backupListSections([entry("1"), entry("2")], "notes");
    expect(sections.map((section) => section.id)).toEqual(["data_folder"]);
    expect(sections[0].groups.map((group) => group.saved)).toEqual([false]);
    expect(sections[0].keys).toEqual(["1-notes.zip", "2-notes.zip"]);
    expect(backupListSections([], "notes")).toEqual([]);
  });

  it("finds the folder above saves when it holds only pins", () => {
    const [section] = backupListSections([entry("1", { saved: true })], "notes");
    expect(section.folder).toBe("/data/.upriv/vaults/notes/backups");
  });

  it("has no folder when the list gave no path", () => {
    const [section] = backupListSections([{ stamp: "1", createdAt: "" }], "notes");
    expect(section.folder).toBeNull();
  });

  it("finds the folder of a Windows path", () => {
    const [section] = backupListSections(
      [{ stamp: "1", createdAt: "", path: "D:\\Backups\\upriv-notes-backups\\1-notes.zip" }],
      "notes",
    );
    expect(section.folder).toBe("D:\\Backups\\upriv-notes-backups");
  });
});

describe("section selection", () => {
  const keys = ["a", "b"];

  it("says how much of the section is selected", () => {
    expect(backupSectionSelection(keys, new Set())).toBe("none");
    expect(backupSectionSelection(keys, new Set(["a", "other"]))).toBe("some");
    expect(backupSectionSelection(keys, new Set(["a", "b"]))).toBe("all");
  });

  it("selects the whole section, then clears it, and leaves other sections alone", () => {
    const some = toggleBackupSection(new Set(["a", "other"]), keys);
    expect([...some].sort()).toEqual(["a", "b", "other"]);
    expect([...toggleBackupSection(some, keys)]).toEqual(["other"]);
  });
});
