import { describe, expect, it } from "vitest";
import { formatImportOutcomeToast, importOutcomeToast } from "../importToast";

describe("importOutcomeToast", () => {
  it("returns null when nothing was imported or skipped", () => {
    expect(importOutcomeToast(0, 0, 0)).toBeNull();
  });

  it("does not treat skipped binaries as imported", () => {
    expect(importOutcomeToast(0, 0, 2)).toEqual({
      primary: "modal.file_manager.toast.import_skipped_unsupported",
      primaryCount: 2,
      extra: [],
    });
  });

  it("appends an unsupported suffix when some files imported", () => {
    expect(importOutcomeToast(3, 0, 1)).toEqual({
      primary: "modal.file_manager.toast.imported",
      primaryCount: 3,
      extra: [
        {
          key: "modal.file_manager.toast.import_skipped_unsupported_suffix",
          count: 1,
        },
      ],
    });
  });

  it("formats mixed skip counts without claiming a full import", () => {
    const message = formatImportOutcomeToast(0, 2, 1, (key, vars) => `${key}:${vars?.count ?? 0}`);
    expect(message).toContain("import_skipped_invalid:2");
    expect(message).toContain("import_skipped_unsupported_suffix:1");
    expect(message).not.toContain("imported");
  });
});
