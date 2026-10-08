import { describe, expect, it } from "vitest";
import {
  isAndroidDocumentsDefaultGrant,
  isAndroidDocumentsUprivFolder,
  isAndroidSharedDocumentsRoot,
  rememberedCustomFolderPath,
} from "../documentsGrant";

describe("isAndroidSharedDocumentsRoot", () => {
  it("matches the Documents directory and not a folder inside it", () => {
    expect(
      isAndroidSharedDocumentsRoot(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments",
      ),
    ).toBe(true);
    expect(
      isAndroidSharedDocumentsRoot(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments",
      ),
    ).toBe(true);
    expect(
      isAndroidSharedDocumentsRoot(
        "content://com.android.externalstorage.documents/tree/home%3ADocuments",
      ),
    ).toBe(true);
    expect(
      isAndroidSharedDocumentsRoot(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv/document/primary%3ADocuments%2FUpriv",
      ),
    ).toBe(false);
  });

  it("matches Documents/Upriv and not the Documents directory", () => {
    expect(
      isAndroidDocumentsUprivFolder(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv/document/primary%3ADocuments%2FUpriv",
      ),
    ).toBe(true);
    expect(
      isAndroidDocumentsUprivFolder(
        "content://com.android.externalstorage.documents/tree/home%3ADocuments%2FUpriv",
      ),
    ).toBe(true);
    expect(
      isAndroidDocumentsUprivFolder(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments",
      ),
    ).toBe(false);
  });

  it("treats Documents and Documents/Upriv as the default grant", () => {
    expect(
      isAndroidDocumentsDefaultGrant(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments",
      ),
    ).toBe(true);
    expect(
      isAndroidDocumentsDefaultGrant(
        "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv",
      ),
    ).toBe(true);
    expect(
      isAndroidDocumentsDefaultGrant(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload",
      ),
    ).toBe(false);
  });

  it("does not restore the Documents default grant as a custom folder", () => {
    const documents = "content://com.android.externalstorage.documents/tree/primary%3ADocuments";
    const download = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
    expect(rememberedCustomFolderPath(documents)).toBe("");
    expect(rememberedCustomFolderPath(`  ${documents}  `)).toBe("");
    expect(rememberedCustomFolderPath("")).toBe("");
    expect(rememberedCustomFolderPath(download)).toBe(download);
  });
});
