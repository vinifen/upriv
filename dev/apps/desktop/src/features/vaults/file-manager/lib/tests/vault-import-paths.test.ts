import { describe, expect, it } from "vitest";
import { relativePathFromImportFile } from "../vaultImportPaths";

describe("relativePathFromImportFile", () => {
  it("prefers webkitRelativePath when present", () => {
    const file = new File([], "notes.md");
    Object.defineProperty(file, "webkitRelativePath", {
      value: "docs/notes.md",
    });
    expect(relativePathFromImportFile(file)).toBe("docs/notes.md");
  });

  it("falls back to file.name", () => {
    expect(relativePathFromImportFile(new File([], "solo.md"))).toBe("solo.md");
  });
});
