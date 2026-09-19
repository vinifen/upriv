import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_UI_LOG_EVENTS,
  IMPORT_CACHE_WIPE_FAILED_LOG_EVENT,
  shouldRecordVaultHidden,
} from "../events";

describe("shouldRecordVaultHidden", () => {
  it("records the transition onto hidden and never the name", () => {
    expect(shouldRecordVaultHidden(false, true)).toBe(true);
    expect(shouldRecordVaultHidden(undefined, true)).toBe(true);
    expect(shouldRecordVaultHidden(true, true)).toBe(false);
    expect(shouldRecordVaultHidden(true, false)).toBe(false);
    expect(shouldRecordVaultHidden(false, false)).toBe(false);
  });
});

describe("allowlisted UI log events", () => {
  it("names the picker-cache wipe failure without a path", () => {
    expect(IMPORT_CACHE_WIPE_FAILED_LOG_EVENT).toBe("import_cache_wipe_failed");
    expect(ALLOWLISTED_UI_LOG_EVENTS).toContain(IMPORT_CACHE_WIPE_FAILED_LOG_EVENT);
  });
});
