import { describe, expect, it } from "vitest";
import { shouldRecordVaultHidden } from "../events";

describe("shouldRecordVaultHidden", () => {
  it("records the transition onto hidden and never the name", () => {
    expect(shouldRecordVaultHidden(false, true)).toBe(true);
    expect(shouldRecordVaultHidden(undefined, true)).toBe(true);
    expect(shouldRecordVaultHidden(true, true)).toBe(false);
    expect(shouldRecordVaultHidden(true, false)).toBe(false);
    expect(shouldRecordVaultHidden(false, false)).toBe(false);
  });
});
