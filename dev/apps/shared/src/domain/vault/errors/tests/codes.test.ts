import { describe, expect, it } from "vitest";
import { isVaultErrorCode, VAULT_ERROR_CODES } from "../..";

describe("isVaultErrorCode", () => {
  it("accepts known vault error codes", () => {
    for (const code of Object.values(VAULT_ERROR_CODES)) {
      expect(isVaultErrorCode(code)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isVaultErrorCode("not_a_vault_error")).toBe(false);
    expect(isVaultErrorCode("")).toBe(false);
  });
});
