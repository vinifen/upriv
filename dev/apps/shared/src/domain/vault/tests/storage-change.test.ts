import { describe, expect, it } from "vitest";
import { parseStorageChangeResult, storageChangeReportLines } from "..";

describe("parseStorageChangeResult", () => {
  it("reads the stored value", () => {
    expect(
      parseStorageChangeResult({ storage: { mode: "upriv_plain", plain_files: "whole" } }),
    ).toEqual({ storage: { mode: "upriv_plain", plain_files: "whole" } });
  });

  it("refuses an answer that names no value it knows", () => {
    expect(parseStorageChangeResult(null)).toBeNull();
    expect(
      parseStorageChangeResult({ storage: { mode: "later", plain_files: "whole" } }),
    ).toBeNull();
    expect(parseStorageChangeResult({ storage: { mode: "encrypted_dir" } })).toBeNull();
  });
});

describe("storageChangeReportLines", () => {
  const changed = (mode: "encrypted_dir" | "upriv_plain", plain_files: "chosen" | "whole") => ({
    result: { storage: { mode, plain_files } },
    stopped: false,
  });

  it("names the value stored", () => {
    expect(storageChangeReportLines(changed("encrypted_dir", "chosen"))).toEqual([
      { key: "vault.change_storage.success_encrypted" },
    ]);
    expect(storageChangeReportLines(changed("upriv_plain", "chosen"))).toEqual([
      { key: "vault.change_storage.success_plain_chosen" },
    ]);
    expect(storageChangeReportLines(changed("upriv_plain", "whole"))).toEqual([
      { key: "vault.change_storage.success_plain_whole" },
    ]);
  });

  it("says a stop changed nothing, and leaves a failure to the error line", () => {
    expect(storageChangeReportLines({ result: null, stopped: true })).toEqual([
      { key: "vault.change_storage.stopped" },
    ]);
    expect(storageChangeReportLines({ result: null, stopped: false })).toBeNull();
  });
});
