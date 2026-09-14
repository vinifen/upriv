import { describe, expect, it } from "vitest";
import {
  isVaultCredentialChallengeI18nKey,
  isVaultErrorCode,
  requireVaultErrorI18nKey,
  VAULT_ERROR_CODES,
} from "../..";

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

describe("isVaultCredentialChallengeI18nKey", () => {
  it("keeps retryable unlock failures on the password dialog", () => {
    expect(isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("wrong_password"))).toBe(
      true,
    );
    expect(
      isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("vault_unlock_blocked")),
    ).toBe(true);
    expect(isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("insufficient_ram"))).toBe(
      true,
    );
    expect(isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("vault_not_found"))).toBe(
      false,
    );
  });
});
