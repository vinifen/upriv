import { describe, expect, it } from "vitest";
import { safDocumentName } from "../safDocumentName";

describe("safDocumentName", () => {
  it("reads the last segment of a SAF tree URI", () => {
    expect(
      safDocumentName(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes",
      ),
    ).toBe("notes");
  });

  it("reads a nested document URI", () => {
    expect(
      safDocumentName(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes/document/primary%3ADownload%2Fnotes%2Fa.md",
      ),
    ).toBe("a.md");
  });

  it("returns empty for blank input", () => {
    expect(safDocumentName("")).toBe("");
    expect(safDocumentName("   ")).toBe("");
  });
});
