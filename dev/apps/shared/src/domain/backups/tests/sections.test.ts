import { describe, expect, it } from "vitest";
import { backupListSections, backupSectionSelection, toggleBackupSection } from "../sections";
import type { VaultBackupEntry, VaultBackupSection } from "../types";

function entry(key: string, saved = false): VaultBackupEntry {
  return {
    key,
    stamp: "20260101000000",
    fileName: key.slice(key.lastIndexOf("/") + 1),
    name: "",
    createdAt: "",
    sizeBytes: 1,
    saved,
    path: `/x/${key}`,
  };
}

function section(
  folder: string,
  entries: VaultBackupEntry[],
  status: VaultBackupSection["status"] = "ok",
): VaultBackupSection {
  return {
    folder,
    kind: folder === "data" ? "data_folder" : "other",
    path: `/x/${folder}`,
    device: null,
    status,
    entries,
  };
}

describe("backupListSections", () => {
  it("lists Saves before Standard in each folder, in core's order", () => {
    const sections = backupListSections({
      sections: [
        section("data", [entry("data/a.zip"), entry("data/saves/b.zip", true)]),
        section("f1", [entry("f1/c.zip")]),
      ],
    });
    expect(sections.map((one) => one.id)).toEqual(["data", "f1"]);
    expect(sections[0].groups.map((group) => group.saved)).toEqual([true, false]);
    expect(sections[0].keys).toEqual(["data/saves/b.zip", "data/a.zip"]);
  });

  it("shows an empty folder only while it cannot be reached", () => {
    const sections = backupListSections({
      sections: [section("data", []), section("f1", [], "missing")],
    });
    expect(sections.map((one) => one.id)).toEqual(["f1"]);
  });
});

describe("section selection", () => {
  it("selects a whole section and clears it again", () => {
    const keys = ["data/a.zip", "data/b.zip"];
    const all = toggleBackupSection(new Set(), keys);
    expect(backupSectionSelection(keys, all)).toBe("all");
    expect(backupSectionSelection(keys, new Set(["data/a.zip"]))).toBe("some");
    expect(backupSectionSelection(keys, toggleBackupSection(all, keys))).toBe("none");
  });
});
