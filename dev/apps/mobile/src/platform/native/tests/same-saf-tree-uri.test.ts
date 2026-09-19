import { describe, expect, it } from "vitest";
import { sameSafTreeUri, shouldReleaseImportTreePermission } from "../sameSafTreeUri";

const DOWNLOAD =
  "content://com.android.externalstorage.documents/tree/primary%3ADownload";
const DOWNLOAD_DECODED =
  "content://com.android.externalstorage.documents/tree/primary:Download";
const DOWNLOAD_DOCUMENT =
  "content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload";
const NOTES =
  "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes";

describe("sameSafTreeUri", () => {
  it("treats percent-encoding and document leaf as the same tree", () => {
    expect(sameSafTreeUri(DOWNLOAD, DOWNLOAD_DECODED)).toBe(true);
    expect(sameSafTreeUri(DOWNLOAD, DOWNLOAD_DOCUMENT)).toBe(true);
  });

  it("distinguishes a nested tree from its parent", () => {
    expect(sameSafTreeUri(DOWNLOAD, NOTES)).toBe(false);
  });

  it("rejects blank input", () => {
    expect(sameSafTreeUri("", DOWNLOAD)).toBe(false);
    expect(sameSafTreeUri("   ", DOWNLOAD)).toBe(false);
  });
});

describe("shouldReleaseImportTreePermission", () => {
  it("releases when there is no active vault-root tree", () => {
    expect(shouldReleaseImportTreePermission(NOTES, null)).toBe(true);
    expect(shouldReleaseImportTreePermission(NOTES, "")).toBe(true);
  });

  it("keeps the grant when the import tree is the vault-root", () => {
    expect(shouldReleaseImportTreePermission(DOWNLOAD, DOWNLOAD_DECODED)).toBe(false);
  });

  it("releases a different folder", () => {
    expect(shouldReleaseImportTreePermission(NOTES, DOWNLOAD)).toBe(true);
  });

  it("ignores non-content URIs", () => {
    expect(shouldReleaseImportTreePermission("/storage/emulated/0/Download", null)).toBe(
      false,
    );
  });
});
