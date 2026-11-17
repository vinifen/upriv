import { describe, expect, it } from "vitest";
import {
  errorOnPasswordField,
  isVaultCredentialChallengeI18nKey,
  isVaultErrorCode,
  offersVaultRebuild,
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
    expect(
      isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("insufficient_ram_export")),
    ).toBe(false);
    expect(isVaultCredentialChallengeI18nKey(requireVaultErrorI18nKey("vault_not_found"))).toBe(
      false,
    );
    expect(errorOnPasswordField(requireVaultErrorI18nKey("wrong_password"))).toBe(true);
    expect(errorOnPasswordField(requireVaultErrorI18nKey("vault_unlock_blocked"))).toBe(true);
    expect(errorOnPasswordField(requireVaultErrorI18nKey("insufficient_ram"))).toBe(false);
    expect(errorOnPasswordField(requireVaultErrorI18nKey("password_change_space_short"))).toBe(
      false,
    );
  });

  it("marks the field for an earlier password and for a change that waits for the new one", () => {
    for (const code of ["password_outdated", "password_change_interrupted"] as const) {
      const key = requireVaultErrorI18nKey(code);
      expect(isVaultCredentialChallengeI18nKey(key)).toBe(true);
      expect(errorOnPasswordField(key)).toBe(true);
      expect(offersVaultRebuild(key)).toBe(false);
    }
  });

  it("keeps a lost index or header on the dialog, which offers the rebuild", () => {
    for (const code of ["vault_index_unreadable", "vault_header_unreadable"] as const) {
      const lost = requireVaultErrorI18nKey(code);
      expect(isVaultCredentialChallengeI18nKey(lost)).toBe(true);
      expect(offersVaultRebuild(lost)).toBe(true);
      // The rebuild takes the password typed: the field is not marked.
      expect(errorOnPasswordField(lost)).toBe(false);
    }
    expect(offersVaultRebuild(requireVaultErrorI18nKey("wrong_password"))).toBe(false);
    expect(offersVaultRebuild(null)).toBe(false);
  });
});
