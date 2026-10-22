import { describe, expect, it } from "vitest";
import cases from "../zip-name-cases.json";
import {
  DATA_FOLDER_ZIP_NAME_MAX_BYTES,
  dataFolderZipDefaultName,
  dataFolderZipNameFromInput,
  dataFolderZipNameIssue,
  dataFolderZipNameIssueI18nKey,
} from "../zipName";

describe("dataFolderZipNameIssue", () => {
  it("agrees with core on the shared cases", () => {
    for (const name of cases.valid) {
      expect(dataFolderZipNameIssue(name), name).toBeNull();
    }
    for (const name of cases.invalid) {
      expect(dataFolderZipNameIssue(name), JSON.stringify(name)).not.toBeNull();
    }
  });

  it("tells an empty name apart, so only Export turns off", () => {
    expect(dataFolderZipNameIssue("")).toBe("empty");
    expect(dataFolderZipNameIssueI18nKey("empty")).toBeNull();
    expect(dataFolderZipNameIssueI18nKey("invalid")).toBe("error.data_folder_export_name_invalid");
  });

  it("counts UTF-8 bytes like core", () => {
    const longest = "a".repeat(DATA_FOLDER_ZIP_NAME_MAX_BYTES);
    expect(dataFolderZipNameIssue(longest)).toBeNull();
    expect(dataFolderZipNameIssue(`${longest}a`)).toBe("too_long");
    const accented = "é".repeat(DATA_FOLDER_ZIP_NAME_MAX_BYTES / 2);
    expect(dataFolderZipNameIssue(accented)).toBeNull();
    expect(dataFolderZipNameIssue(`${accented}é`)).toBe("too_long");
  });

  it("refuses a lone surrogate", () => {
    expect(dataFolderZipNameIssue("copy\ud800")).toBe("invalid");
  });
});

describe("dataFolderZipNameFromInput", () => {
  it("trims and drops a .zip the person typed", () => {
    expect(dataFolderZipNameFromInput("  trip copy  ")).toBe("trip copy");
    expect(dataFolderZipNameFromInput("trip copy.ZIP")).toBe("trip copy");
    expect(dataFolderZipNameFromInput("trip .zip")).toBe("trip");
    expect(dataFolderZipNameFromInput(".zip")).toBe("");
  });

  it("keeps a name that only contains zip", () => {
    expect(dataFolderZipNameFromInput("zipped")).toBe("zipped");
  });
});

describe("dataFolderZipDefaultName", () => {
  it("stamps the date and time in UTC", () => {
    expect(dataFolderZipDefaultName(new Date(Date.UTC(2026, 9, 19, 7, 5, 3)))).toBe(
      "upriv-2026-10-19-070503",
    );
    expect(dataFolderZipNameIssue(dataFolderZipDefaultName(new Date()))).toBeNull();
  });
});
