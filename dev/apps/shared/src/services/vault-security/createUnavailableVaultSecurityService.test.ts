import { describe, expect, it } from "vitest";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import { createUnavailableVaultSecurityService } from "./createUnavailableVaultSecurityService";

describe("createUnavailableVaultSecurityService", () => {
  it("rejects password and KDF change with vault_rewrap_unavailable", async () => {
    const service = createUnavailableVaultSecurityService();
    await expect(
      service.changePassword("notes", { currentPassword: "a", newPassword: "b" }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.REWRAP_UNAVAILABLE });
    await expect(
      service.changeKdfPreset("notes", { currentPassword: "a", nextPreset: "256mib" }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.REWRAP_UNAVAILABLE });
  });
});
