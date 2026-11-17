import { describe, expect, it } from "vitest";
import type { DeviceSystem } from "../../device";
import { folderPathIssue, folderShownName, sameFolderPath } from "../paths";
import type { FolderListKind } from "../types";
import cases from "../folder-path-cases.json";

interface ValidCase {
  system: DeviceSystem;
  list: FolderListKind;
  path: string;
  issue: string | null;
}

describe("folder path rules (shared with core)", () => {
  it("checks a row against its own group's system", () => {
    for (const item of cases.valid as ValidCase[]) {
      expect(folderPathIssue(item.system, item.list, item.path), JSON.stringify(item)).toBe(
        item.issue,
      );
    }
  });

  it("tells the same folder apart per system", () => {
    for (const item of cases.same) {
      expect(
        sameFolderPath(item.system as DeviceSystem, item.a, item.b),
        JSON.stringify(item),
      ).toBe(item.same);
    }
  });
});

describe("folderShownName", () => {
  const tree = "content://com.android.externalstorage.documents/tree/";

  it("names a phone's tree by its folder in the phone's own storage", () => {
    expect(folderShownName(`${tree}primary%3ADocuments`)).toBe("Documents");
    expect(folderShownName(` ${tree}primary%3ADocuments%2FUpriv `)).toBe("Documents/Upriv");
    expect(folderShownName(`${tree}home%3ADocuments`)).toBe("Documents");
  });

  it("puts another volume's id before its folder", () => {
    expect(folderShownName(`${tree}1234-5678%3AUpriv`)).toBe("1234-5678/Upriv");
    expect(folderShownName(`${tree}1234-5678%3A`)).toBe("1234-5678");
  });

  it("reads the tree, not a document inside it", () => {
    expect(folderShownName(`${tree}primary%3ADCIM/document/primary%3ADCIM%2FCamera`)).toBe("DCIM");
  });

  it("shows any other path as typed", () => {
    expect(folderShownName(" /home/vini/Music ")).toBe("/home/vini/Music");
    expect(folderShownName("D:\\Backups")).toBe("D:\\Backups");
    expect(folderShownName("content://odd")).toBe("content://odd");
  });
});
