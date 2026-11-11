import { describe, expect, it } from "vitest";
import { parseVaultDeleteOutcome } from "../delete";

describe("parseVaultDeleteOutcome", () => {
  it("reads what happened to the backups outside the data folder", () => {
    expect(parseVaultDeleteOutcome({ outside: "kept", folder: "/mnt/usb/a" })).toEqual({
      outside: "kept",
      folder: "/mnt/usb/a",
    });
    expect(parseVaultDeleteOutcome({ outside: "removed", folder: "/mnt/usb/a" }).outside).toBe(
      "removed",
    );
    expect(parseVaultDeleteOutcome({ outside: "failed", folder: "/mnt/usb/a" }).outside).toBe(
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
