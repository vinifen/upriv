import { describe, expect, it } from "vitest";
import { isSafLogicalRoot, SAF_VAULT_ROOT } from "../androidVaultHome";

describe("isSafLogicalRoot", () => {
  it("matches the rust logical data-folder path", () => {
    expect(SAF_VAULT_ROOT).toBe("/upriv-saf-root");
    expect(isSafLogicalRoot("/upriv-saf-root")).toBe(true);
    expect(isSafLogicalRoot("/upriv-saf-root/")).toBe(true);
  });

  it("does not match a picked uri or the app folder", () => {
    expect(
      isSafLogicalRoot("content://com.android.externalstorage.documents/tree/primary%3ADownload"),
    ).toBe(false);
    expect(isSafLogicalRoot("/data/user/0/com.upriv.mobile/files/upriv")).toBe(false);
    expect(isSafLogicalRoot("/upriv-saf-root-extra")).toBe(false);
    expect(isSafLogicalRoot("")).toBe(false);
  });
});
