import { describe, expect, it } from "vitest";
import { parseUnlockedDestination } from "..";

describe("parseUnlockedDestination", () => {
  it("reads each outcome core answers", () => {
    expect(parseUnlockedDestination({ outcome: "off" })).toEqual({ outcome: "off" });
    expect(parseUnlockedDestination({ outcome: "unset" })).toEqual({ outcome: "unset" });
    expect(
      parseUnlockedDestination({
        outcome: "folder",
        path: "/media/usb/upriv-unlocked/Notes",
        class: "removable",
        switches: [],
      }),
    ).toEqual({
      outcome: "folder",
      path: "/media/usb/upriv-unlocked/Notes",
      class: "removable",
      switches: [],
    });
    expect(
      parseUnlockedDestination({
        outcome: "unavailable",
        path: "/media/usb/upriv-unlocked",
        reason: "missing",
      }),
    ).toEqual({ outcome: "unavailable", path: "/media/usb/upriv-unlocked", reason: "missing" });
  });

  it("reads a mount point, which comes with no class", () => {
    expect(
      parseUnlockedDestination({
        outcome: "folder",
        path: "/home/me/upriv-unlocked/Notes",
        switches: [],
      }),
    ).toEqual({
      outcome: "folder",
      path: "/home/me/upriv-unlocked/Notes",
      class: null,
      switches: [],
    });
  });

  it("refuses what is not an answer", () => {
    expect(parseUnlockedDestination(null)).toBeNull();
    expect(parseUnlockedDestination({ outcome: "folder", path: "" })).toBeNull();
    expect(parseUnlockedDestination({ outcome: "later" })).toBeNull();
    expect(parseUnlockedDestination({ path: "/x" })).toBeNull();
  });
});
