import { describe, expect, it } from "vitest";
import { planSafSwitch, rememberedCustomFolderPath } from "../documentsGrant";

const USB = "content://com.android.externalstorage.documents/tree/ABCD-1234%3A";
const OTHER = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const DOCUMENTS =
  "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv";

describe("rememberedCustomFolderPath", () => {
  it("drops the Documents default grant", () => {
    expect(rememberedCustomFolderPath(DOCUMENTS)).toBe("");
    expect(rememberedCustomFolderPath(USB)).toBe(USB);
  });
});

describe("planSafSwitch", () => {
  it("keeps the custom grant when the next folder is the default", () => {
    expect(planSafSwitch(USB, DOCUMENTS)).toEqual({
      rememberCustomUri: USB,
      releaseUri: null,
    });
  });

  it("keeps the custom grant when the active folder is cleared", () => {
    expect(planSafSwitch(USB, "")).toEqual({
      rememberCustomUri: USB,
      releaseUri: null,
    });
  });

  it("replaces the custom grant when another custom folder is chosen", () => {
    expect(planSafSwitch(USB, OTHER)).toEqual({
      rememberCustomUri: OTHER,
      releaseUri: USB,
    });
  });

  it("does not release the Documents grant when a custom folder is chosen", () => {
    expect(planSafSwitch(DOCUMENTS, USB)).toEqual({
      rememberCustomUri: USB,
      releaseUri: null,
    });
  });
});
