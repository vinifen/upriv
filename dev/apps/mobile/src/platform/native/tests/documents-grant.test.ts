import { describe, expect, it } from "vitest";
import {
  isAndroidDocumentsDefaultGrant,
  isAndroidDocumentsUprivFolder,
  isAndroidSharedDocumentsRoot,
} from "../documentsGrant";

const USB = "content://com.android.externalstorage.documents/tree/ABCD-1234%3A";
const DOCUMENTS = "content://com.android.externalstorage.documents/tree/primary%3ADocuments";
const DOCUMENTS_UPRIV =
  "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv";

describe("Default's Documents grant", () => {
  it("is Documents itself, or the Upriv folder inside it", () => {
    expect(isAndroidSharedDocumentsRoot(DOCUMENTS)).toBe(true);
    expect(isAndroidDocumentsUprivFolder(DOCUMENTS_UPRIV)).toBe(true);
    expect(isAndroidDocumentsDefaultGrant(DOCUMENTS)).toBe(true);
    expect(isAndroidDocumentsDefaultGrant(DOCUMENTS_UPRIV)).toBe(true);
  });

  it("is no other folder", () => {
    expect(isAndroidDocumentsDefaultGrant(USB)).toBe(false);
    expect(isAndroidSharedDocumentsRoot(DOCUMENTS_UPRIV)).toBe(false);
  });
});
