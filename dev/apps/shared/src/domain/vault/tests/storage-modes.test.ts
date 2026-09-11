import { describe, expect, it } from "vitest";
import { STORAGE_MODES, storageModeIsPlaintext } from "..";

describe("STORAGE_MODES", () => {
  it("lists the two remaining modes", () => {
    expect(STORAGE_MODES).toEqual(["encrypted_dir", "upriv_plain"]);
  });
});

describe("storageModeIsPlaintext", () => {
  it("is true only for upriv_plain", () => {
    expect(storageModeIsPlaintext("upriv_plain")).toBe(true);
    expect(storageModeIsPlaintext("encrypted_dir")).toBe(false);
  });
});
