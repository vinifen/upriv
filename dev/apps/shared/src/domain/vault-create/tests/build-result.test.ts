import { describe, expect, it } from "vitest";
import { buildCreateVaultResult } from "..";
import { createVaultDraftFixture } from "./fixtures";

describe("buildCreateVaultResult", () => {
  it("builds normalized settings and vault id from draft", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([1, 2], {
        displayName: "My Vault",
        storage: { mode: "plain_only" },
        close: { default_action: "close" },
        security: { mode: "session_ram", secure_wipe_workspace: true },
      }),
      ["existing-id"],
    );

    expect(result.vaultId).toBe("my-vault");
    expect(result.storageMode).toBe("plain_only");
    expect(result.settings.storage.mode).toBe("plain_only");
    expect(result.settings.close.default_action).toBe("seal");
    expect(result.settings.security.mode).toBe("session_ram");
    expect(result.settings.vault.order).toBe(3);
    expect(result.groupAssignment).toEqual({ kind: "none" });
  });

  it("carries deferred existing-group assignment", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        groupMode: "existing",
        groupId: "work",
      }),
      [],
    );
    expect(result.groupAssignment).toEqual({ kind: "existing", groupId: "work" });
  });

  it("carries deferred create-group assignment", () => {
    const result = buildCreateVaultResult(
      createVaultDraftFixture([], {
        groupMode: "create",
        groupName: "  Travel  ",
      }),
      [],
    );
    expect(result.groupAssignment).toEqual({ kind: "create", displayName: "Travel" });
  });
});
