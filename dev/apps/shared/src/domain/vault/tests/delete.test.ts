import { describe, expect, it } from "vitest";
import { parseVaultDeleteOutcome } from "../delete";

describe("parseVaultDeleteOutcome", () => {
  it("reads what happened to the backups outside the data folder, and their first folder", () => {
    expect(
      parseVaultDeleteOutcome({ outside: "kept", folders: ["/mnt/usb/a", "/mnt/usb/b"] }),
    ).toEqual({
      outside: "kept",
      folder: "/mnt/usb/a",
    });
    expect(parseVaultDeleteOutcome({ outside: "removed", folders: [] })).toEqual({
      outside: "removed",
      folder: null,
    });
    expect(parseVaultDeleteOutcome({ outside: "failed", folders: ["/mnt/usb/a"] }).outside).toBe(
      "failed",
    );
  });

  it("reads anything else as a vault with none outside", () => {
    expect(parseVaultDeleteOutcome({ outside: "melted" })).toEqual({
      outside: "none",
      folder: null,
    });
    expect(parseVaultDeleteOutcome(null)).toEqual({ outside: "none", folder: null });
  });
});
