import { describe, expect, it } from "vitest";
import { createEmptyCreateVaultDraft, defaultOrderAtEnd } from "..";

describe("defaultOrderAtEnd", () => {
  it("returns 1 for empty list", () => {
    expect(defaultOrderAtEnd([])).toBe(1);
  });

  it("returns max + 1", () => {
    expect(defaultOrderAtEnd([1, 5, 3])).toBe(6);
  });
});

describe("createEmptyCreateVaultDraft", () => {
  it("defaults to encrypted_dir and encrypt_only compression", () => {
    const draft = createEmptyCreateVaultDraft([2, 4]);
    expect(draft.storage.mode).toBe("encrypted_dir");
    expect(draft.seven_zip.archive_mode).toBe("encrypt_only");
    expect(draft.seven_zip.compression_level).toBe(0);
    expect(draft.order).toBe(5);
  });
});
