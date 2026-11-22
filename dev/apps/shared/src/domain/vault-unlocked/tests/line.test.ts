import { describe, expect, it } from "vitest";
import { plainFolderNote, unlockFolderLine, type UnlockedDestination } from "..";

const folder = (path: string, cls: "local" | "cloud" | null): UnlockedDestination => ({
  outcome: "folder",
  path,
  class: cls,
  switches: [],
});

describe("unlockFolderLine", () => {
  it("names where plain text goes, with the warning of a cloud folder", () => {
    expect(unlockFolderLine(folder("/home/me/Dropbox/Notes", "cloud"), "upriv_plain")).toEqual({
      key: "unlock.folder.plain",
      params: { path: "/home/me/Dropbox/Notes" },
      warning: "plain.place.class.cloud",
    });
    expect(unlockFolderLine(folder("/home/me/Notes", "local"), "upriv_plain")?.warning).toBeNull();
  });

  it("leaves no plain-text line when the window asks where first or the open is refused", () => {
    expect(unlockFolderLine({ outcome: "unset" }, "upriv_plain")).toBeNull();
    expect(
      unlockFolderLine(
        { outcome: "unavailable", path: "/media/usb", reason: "missing" },
        "upriv_plain",
      ),
    ).toBeNull();
  });

  it("names an encrypted vault's mount point, and says when none is chosen or answers", () => {
    expect(
      unlockFolderLine(folder("/home/me/upriv-unlocked/Notes", null), "encrypted_dir"),
    ).toEqual({
      key: "unlock.folder.mount",
      params: { path: "/home/me/upriv-unlocked/Notes" },
      warning: null,
    });
    expect(unlockFolderLine({ outcome: "unset" }, "encrypted_dir")?.key).toBe(
      "unlock.folder.mount_unset",
    );
    expect(
      unlockFolderLine(
        { outcome: "unavailable", path: "/media/usb", reason: "missing" },
        "encrypted_dir",
      )?.key,
    ).toBe("unlock.folder.mount_unavailable");
  });

  it("shows nothing for a vault whose folder is off", () => {
    expect(unlockFolderLine({ outcome: "off" }, "encrypted_dir")).toBeNull();
  });
});

describe("plainFolderNote", () => {
  it("names the folder to check, or says the unlock will ask", () => {
    expect(plainFolderNote(folder("/media/usb/Notes", "local"))).toEqual({
      key: "modal.storage.note.folder",
      params: { path: "/media/usb/Notes" },
      warning: null,
    });
    expect(plainFolderNote({ outcome: "unset" })?.key).toBe("modal.storage.note.unset");
    expect(
      plainFolderNote({ outcome: "unavailable", path: "/media/usb", reason: "missing" })?.key,
    ).toBe("modal.storage.note.unavailable");
  });
});
